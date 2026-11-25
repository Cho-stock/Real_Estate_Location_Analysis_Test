import 'dotenv/config';
import express from 'express';
import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  KOREA_REGIONS,
  SIDO_NAMES_BY_CODE,
  findRegionBySggCode,
} from './src/data/regions.ts';
import { SEOUL_CITYDATA_HOTSPOTS } from './src/data/seoulHotspots.ts';
import type {
  AnalysisResponse,
  ApiSourceSpec,
  BuildingLedgerSummary,
  BuildingRegisterResult,
  BusStopRecord,
  CategoryStat,
  ClosedBuildingRecord,
  CommercialStoreRecord,
  CommercialSummary,
  ComplexOption,
  DatasetResult,
  FloorStat,
  GeocodeResult,
  HospitalRecord,
  LocationQueryParams,
  PropertyType,
  RebStatRecord,
  RebSummary,
  RegionOptionsResponse,
  ResolvedLocationInfo,
  SchoolKindStat,
  SchoolRecord,
  SchoolSummary,
  SearchPlaceCandidate,
  SeoulCityDataCategoryStat,
  SeoulCityDataForecastItem,
  SeoulCityDataSummary,
  SeoulParkingStatusItem,
  SeoulTransitIntervalStat,
  SeoulTransitSummary,
  SubwayStationRecord,
  TransactionRecord,
  TransactionSummary,
} from './src/types/analysis.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: false,
});

interface SeoulHotspotAreaEntry {
  category: string;
  name: string;
  rings: Array<Array<[number, number]>>;
}

const SEOUL_HOTSPOT_AREAS: Record<string, SeoulHotspotAreaEntry> = (() => {
  try {
    const raw = fs.readFileSync(
      path.join(__dirname, 'src/data/seoulHotspotAreas.json'),
      'utf8'
    );
    return JSON.parse(raw) as Record<string, SeoulHotspotAreaEntry>;
  } catch {
    return {};
  }
})();

const geocodeCache = new Map<
  string,
  { expiresAt: number; lat: number | null; lng: number | null; source: string }
>();
const regionOptionsCache = new Map<
  string,
  { expiresAt: number; data: RegionOptionsResponse }
>();
const reverseRegionCache = new Map<
  string,
  {
    expiresAt: number;
    data: {
      sidoCode: string;
      sggCode: string;
      sidoName: string;
      sggName: string;
      dongName: string;
    } | null;
  }
>();
const subwayCache = new Map<
  string,
  { expiresAt: number; items: SubwayStationRecord[] }
>();
const busStopCache = new Map<
  string,
  { expiresAt: number; items: BusStopRecord[] }
>();
const buildingRegisterCache = new Map<
  string,
  { expiresAt: number; data: BuildingRegisterResult }
>();
const seoulCityDataCache = new Map<
  string,
  {
    expiresAt: number;
    data: Omit<
      SeoulCityDataSummary,
      'configured' | 'supported' | 'distanceMeters' | 'nearbyHotspots'
    >;
  }
>();

function isConfigured(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('MY_')) return false;
  return true;
}

function encodeServiceKey(rawKey: string): string {
  return rawKey.includes('%') ? rawKey : encodeURIComponent(rawKey);
}

function toNumberOrNull(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const cleaned = String(val).replace(/,/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function haversineMeters(
  lat1: number | null,
  lng1: number | null,
  lat2: number | null,
  lng2: number | null
): number | null {
  if (lat1 === null || lng1 === null || lat2 === null || lng2 === null) {
    return null;
  }
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function mapSchoolKindName(code: string): string {
  switch (code) {
    case '02':
      return '초등학교';
    case '03':
      return '중학교';
    case '04':
      return '고등학교';
    case '05':
      return '특수학교';
    case '06':
      return '그외학교';
    case '07':
      return '각종학교';
    default:
      return code || '';
  }
}

function resolveRegionNames(sidoCode: string, sggCode: string): {
  sidoName: string;
  sggName: string;
} {
  const bySgg = sggCode ? findRegionBySggCode(sggCode) : null;
  if (bySgg) {
    return {
      sidoName: bySgg.sido.name,
      sggName: bySgg.district.name,
    };
  }
  const sido = KOREA_REGIONS.find((r) => r.sidoCode === sidoCode);
  return {
    sidoName: sido?.name ?? SIDO_NAMES_BY_CODE[sidoCode] ?? '',
    sggName: '',
  };
}

function formatRoadAddress(row: Record<string, unknown>): string {
  const roadNm = String(row.roadNm ?? row.roadnm ?? '').trim();
  if (!roadNm) return '';
  if (/\d/.test(roadNm) && !row.roadNmBonbun && !row.roadnmbonbun) {
    return roadNm;
  }
  const bon = String(row.roadNmBonbun ?? row.roadnmbonbun ?? '')
    .replace(/^0+/, '')
    .trim();
  const bu = String(row.roadNmBubun ?? row.roadnmbubun ?? '')
    .replace(/^0+/, '')
    .trim();
  if (!bon || roadNm.endsWith(` ${bon}`)) return roadNm;
  return bu ? `${roadNm} ${bon}-${bu}` : `${roadNm} ${bon}`;
}

async function searchEpostAddress(
  query: string
): Promise<Array<{ zipNo: string; roadAddress: string; lotAddress: string }>> {
  const apiKey = process.env.PUBLIC_DATA_API_KEY;
  if (!isConfigured(apiKey) || !query.trim()) return [];

  const encKey = encodeServiceKey(apiKey.trim());
  const trimmed = query.trim();

  // Choose heuristic search order: 5-digit zip -> post; contains 로/길 -> road first, else dong first
  const searchOrder: Array<'road' | 'dong' | 'post'> = /^\d{5}$/.test(trimmed)
    ? ['post']
    : /[가-힣0-9]+(로|길)(\s|$)/.test(trimmed)
      ? ['road', 'dong']
      : ['dong', 'road'];

  for (const searchSe of searchOrder) {
    try {
      const url = `http://openapi.epost.go.kr/postal/retrieveNewAdressAreaCdService/retrieveNewAdressAreaCdService/getNewAddressListAreaCd?serviceKey=${encKey}&searchSe=${searchSe}&srchwrd=${encodeURIComponent(
        trimmed
      )}&countPerPage=10&currentPage=1`;

      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const xmlText = await res.text();
      const parsed = xmlParser.parse(xmlText) as {
        NewAddressListResponse?: {
          cmmMsgHeader?: { successYN?: string };
          newAddressListAreaCd?:
            | Record<string, unknown>
            | Record<string, unknown>[];
        };
      };

      if (parsed.NewAddressListResponse?.cmmMsgHeader?.successYN !== 'Y') {
        continue;
      }

      const rawNode = parsed.NewAddressListResponse?.newAddressListAreaCd;
      const rows = Array.isArray(rawNode) ? rawNode : rawNode ? [rawNode] : [];
      const items = rows
        .map((r) => ({
          zipNo: String(r.zipNo ?? '').trim(),
          roadAddress: String(r.lnmAdres ?? '').trim(),
          lotAddress: String(r.rnAdres ?? '').trim(),
        }))
        .filter((r) => r.roadAddress || r.lotAddress);

      if (items.length > 0) {
        return items;
      }
    } catch {
      continue;
    }
  }

  return [];
}

interface KakaoGeocodeHit {
  lat: number;
  lng: number;
  roadAddress?: string;
  lotAddress?: string;
  zipNo?: string;
  sidoCode?: string;
  sggCode?: string;
  sidoName?: string;
  sggName?: string;
  dongName?: string;
  label?: string;
}

async function geocodeKakao(query: string): Promise<KakaoGeocodeHit | null> {
  const restKey = process.env.KAKAO_REST_API_KEY;
  if (!isConfigured(restKey) || !query.trim()) return null;

  const trimmed = query.trim();
  const headers = {
    Authorization: `KakaoAK ${restKey.trim()}`,
  };

  // 1. Address search (road / parcel)
  try {
    const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(
      trimmed
    )}&size=3`;
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        documents?: Array<{
          address_name?: string;
          x?: string;
          y?: string;
          address?: {
            address_name?: string;
            b_code?: string;
            region_1depth_name?: string;
            region_2depth_name?: string;
            region_3depth_name?: string;
          } | null;
          road_address?: {
            address_name?: string;
            zone_no?: string;
            region_1depth_name?: string;
            region_2depth_name?: string;
            region_3depth_name?: string;
          } | null;
        }>;
      };
      const doc = json.documents?.[0];
      if (doc) {
        const lat = toNumberOrNull(doc.y);
        const lng = toNumberOrNull(doc.x);
        if (lat !== null && lng !== null) {
          const bCode = String(doc.address?.b_code ?? '').trim();
          const sggCode = bCode.length >= 5 ? bCode.slice(0, 5) : undefined;
          const sidoCode = sggCode ? sggCode.slice(0, 2) : undefined;
          const rawSido =
            doc.address?.region_1depth_name ||
            doc.road_address?.region_1depth_name ||
            '';
          const sidoName =
            (sidoCode ? SIDO_NAMES_BY_CODE[sidoCode] : '') || rawSido || undefined;
          const sggName =
            doc.address?.region_2depth_name ||
            doc.road_address?.region_2depth_name ||
            undefined;
          const dongName =
            doc.address?.region_3depth_name ||
            doc.road_address?.region_3depth_name ||
            undefined;

          return {
            lat,
            lng,
            roadAddress: doc.road_address?.address_name || undefined,
            lotAddress: doc.address?.address_name || undefined,
            zipNo: doc.road_address?.zone_no || undefined,
            sidoCode,
            sggCode,
            sidoName,
            sggName,
            dongName,
            label: doc.road_address?.address_name || doc.address_name || undefined,
          };
        }
      }
    }
  } catch {
    // Fall through to keyword search
  }

  // 2. Keyword / POI / complex search
  try {
    const kwUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(
      trimmed
    )}&size=3`;
    const res = await fetch(kwUrl, {
      headers,
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        documents?: Array<{
          place_name?: string;
          address_name?: string;
          road_address_name?: string;
          x?: string;
          y?: string;
        }>;
      };
      const doc = json.documents?.[0];
      if (doc) {
        const lat = toNumberOrNull(doc.y);
        const lng = toNumberOrNull(doc.x);
        if (lat !== null && lng !== null) {
          return {
            lat,
            lng,
            roadAddress: doc.road_address_name || undefined,
            lotAddress: doc.address_name || undefined,
            label:
              doc.road_address_name ||
              doc.address_name ||
              doc.place_name ||
              undefined,
          };
        }
      }
    }
  } catch {
    // Ignore keyword search failure
  }

  return null;
}

async function geocodeNominatim(
  query: string
): Promise<{ lat: number; lng: number } | null> {
  const cacheKey = `nom:${query}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.lat !== null && cached.lng !== null
      ? { lat: cached.lat, lng: cached.lng }
      : null;
  }

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'kr');
    url.searchParams.set('q', query);

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'GeoSiteRealEstateAnalysis/1.0',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const first = rows[0];
    const lat = toNumberOrNull(first?.lat);
    const lng = toNumberOrNull(first?.lon);
    geocodeCache.set(cacheKey, {
      expiresAt: Date.now() + 1000 * 60 * 30,
      lat,
      lng,
      source: 'nominatim',
    });
    if (lat !== null && lng !== null) {
      return { lat, lng };
    }
    return null;
  } catch {
    return null;
  }
}

async function geocodeKoreaAddress(
  query: string
): Promise<{ lat: number; lng: number } | null> {
  const kakaoHit = await geocodeKakao(query);
  if (kakaoHit) {
    return { lat: kakaoHit.lat, lng: kakaoHit.lng };
  }
  return geocodeNominatim(query);
}

async function fetchSchools(params: {
  sidoCode: string;
  sggCode: string;
  schulKndCode: string;
  centerLat: number | null;
  centerLng: number | null;
}): Promise<DatasetResult<SchoolRecord, SchoolSummary>> {
  const apiKey = process.env.SCHOOL_INFO_API_KEY;
  const baseResult: DatasetResult<SchoolRecord, SchoolSummary> = {
    configured: isConfigured(apiKey),
    fetched: false,
    envVarName: 'SCHOOL_INFO_API_KEY',
    sourceName: '학교알리미 Open API',
    items: [],
    summary: null,
    error: null,
  };

  if (!isConfigured(apiKey)) {
    return baseResult;
  }

  try {
    const normalizeSido = (sido: string, sgg: string) =>
      sgg.length === 5 ? sgg.slice(0, 2) : sido;

    const querySchoolApi = async (targetSido: string, targetSgg: string) => {
      const kindCodes = params.schulKndCode
        ? [params.schulKndCode]
        : ['02', '03', '04'];
      const rows: Record<string, unknown>[] = [];
      const sMap = new Map<string, number>();
      const tMap = new Map<string, number>();

      for (const kind of kindCodes) {
        const baseUrl = new URL('https://www.schoolinfo.go.kr/openApi.do');
        baseUrl.searchParams.set('apiKey', apiKey.trim());
        baseUrl.searchParams.set('apiType', '0');
        baseUrl.searchParams.set('sidoCode', targetSido);
        baseUrl.searchParams.set('sggCode', targetSgg);
        baseUrl.searchParams.set('schulKndCode', kind);

        const response = await fetch(baseUrl.toString(), {
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          throw new Error(`학교알리미 API 응답 오류 (${response.status})`);
        }
        const data = (await response.json()) as {
          resultCode?: string;
          resultMsg?: string;
          list?: Record<string, unknown>[];
        };

        if (
          data.resultCode &&
          data.resultCode !== 'success' &&
          data.resultCode !== '00'
        ) {
          return {
            rows: [] as Record<string, unknown>[],
            sMap,
            tMap,
            apiMsg: data.resultMsg || `학교알리미 오류 (${data.resultCode})`,
          };
        }

        if (Array.isArray(data.list)) {
          rows.push(...data.list);
        }

        const [studentRes, teacherRes] = await Promise.allSettled([
          fetch(
            `https://www.schoolinfo.go.kr/openApi.do?apiKey=${encodeURIComponent(
              apiKey.trim()
            )}&apiType=63&pbanYr=2025&sidoCode=${encodeURIComponent(
              targetSido
            )}&sggCode=${encodeURIComponent(targetSgg)}&schulKndCode=${kind}`,
            { signal: AbortSignal.timeout(8000) }
          ),
          fetch(
            `https://www.schoolinfo.go.kr/openApi.do?apiKey=${encodeURIComponent(
              apiKey.trim()
            )}&apiType=08&pbanYr=2025&sidoCode=${encodeURIComponent(
              targetSido
            )}&sggCode=${encodeURIComponent(targetSgg)}&schulKndCode=${kind}`,
            { signal: AbortSignal.timeout(8000) }
          ),
        ]);

        if (studentRes.status === 'fulfilled' && studentRes.value.ok) {
          const sJson = (await studentRes.value.json()) as {
            resultCode?: string;
            list?: Record<string, unknown>[];
          };
          if (sJson.resultCode === 'success' && Array.isArray(sJson.list)) {
            for (const row of sJson.list) {
              const code = String(row.SCHUL_CODE ?? '');
              const sum = toNumberOrNull(row.SUM);
              if (code && sum !== null) sMap.set(code, sum);
            }
          }
        }

        if (teacherRes.status === 'fulfilled' && teacherRes.value.ok) {
          const tJson = (await teacherRes.value.json()) as {
            resultCode?: string;
            list?: Record<string, unknown>[];
          };
          if (tJson.resultCode === 'success' && Array.isArray(tJson.list)) {
            for (const row of tJson.list) {
              const code = String(row.SCHUL_CODE ?? '');
              const tCount = toNumberOrNull(row.ITRT_TCR_TOT_FGR);
              if (code && tCount !== null) tMap.set(code, tCount);
            }
          }
        }
      }
      return { rows, sMap, tMap, apiMsg: null as string | null };
    };

    const primarySido = normalizeSido(params.sidoCode, params.sggCode);
    let outcome = await querySchoolApi(primarySido, params.sggCode);

    // Fallback: if city-level sggCode returned fail/0 rows (e.g. 부천시 41190 -> 원미구 41192)
    if (
      outcome.rows.length === 0 &&
      params.centerLat !== null &&
      params.centerLng !== null
    ) {
      const rev = await reverseLookupRegionByCoords(
        params.centerLat,
        params.centerLng
      );
      if (rev && rev.sggCode && rev.sggCode !== params.sggCode) {
        const retry = await querySchoolApi(
          normalizeSido(rev.sidoCode, rev.sggCode),
          rev.sggCode
        );
        if (retry.rows.length > 0) {
          outcome = retry;
        }
      }
    }

    if (outcome.rows.length === 0 && outcome.apiMsg) {
      throw new Error(outcome.apiMsg);
    }

    const allRows = outcome.rows;
    const studentMap = outcome.sMap;
    const teacherMap = outcome.tMap;

    const items: SchoolRecord[] = allRows.map((row, idx) => {
      const code = String(row.SCHUL_CODE ?? `school-${idx}`);
      const lat = toNumberOrNull(row.LTTUD ?? row.LTTD ?? row.lat);
      const lng = toNumberOrNull(row.LGTUD ?? row.LNGT ?? row.lng);
      const kindCode = String(row.SCHUL_KND_SC_CODE ?? '');
      const roadAddr = String(row.SCHUL_RDNMA ?? '').trim();
      const detailAddr = String(row.SCHUL_RDNDA ?? '').trim();
      const fallbackAddr = String(row.ADRES_BRKDN ?? row.ADRES_BRK ?? '').trim();
      const address = roadAddr
        ? `${roadAddr}${detailAddr ? ` ${detailAddr}` : ''}`
        : fallbackAddr;

      return {
        id: code,
        name: String(row.SCHUL_NM ?? ''),
        kindCode,
        kindName: mapSchoolKindName(kindCode),
        foundationType: String(row.FOND_SC_CODE ?? ''),
        coedType: String(row.COEDU_SC_CODE ?? ''),
        address,
        lat,
        lng,
        studentCount: studentMap.get(code) ?? toNumberOrNull(row.SUM_STDNT_CO),
        teacherCount: teacherMap.get(code) ?? toNumberOrNull(row.TEACHR_CO),
        distanceMeters: haversineMeters(params.centerLat, params.centerLng, lat, lng),
      };
    });

    items.sort((a, b) => {
      if (a.distanceMeters !== null && b.distanceMeters !== null) {
        return a.distanceMeters - b.distanceMeters;
      }
      return a.name.localeCompare(b.name, 'ko');
    });

    if (items.length === 0) {
      return {
        ...baseResult,
        fetched: true,
        items: [],
        summary: null,
      };
    }

    const elementaryCount = items.filter((s) => s.kindCode === '02').length;
    const middleCount = items.filter((s) => s.kindCode === '03').length;
    const highCount = items.filter((s) => s.kindCode === '04').length;
    const otherCount = items.length - elementaryCount - middleCount - highCount;

    const studentValues = items
      .map((s) => s.studentCount)
      .filter((v): v is number => v !== null);
    const teacherValues = items
      .map((s) => s.teacherCount)
      .filter((v): v is number => v !== null);

    const totalStudents =
      studentValues.length > 0
        ? studentValues.reduce((acc, v) => acc + v, 0)
        : null;
    const totalTeachers =
      teacherValues.length > 0
        ? teacherValues.reduce((acc, v) => acc + v, 0)
        : null;
    const studentsPerTeacher =
      totalStudents !== null && totalTeachers !== null && totalTeachers > 0
        ? Number((totalStudents / totalTeachers).toFixed(1))
        : null;

    const kindMap = new Map<string, number>();
    for (const s of items) {
      const label = s.kindName || '기타';
      kindMap.set(label, (kindMap.get(label) ?? 0) + 1);
    }
    const kindDistribution: SchoolKindStat[] = Array.from(kindMap.entries()).map(
      ([kindName, count]) => ({
        kindName,
        count,
        ratio: Number(((count / items.length) * 100).toFixed(1)),
      })
    );

    return {
      ...baseResult,
      fetched: true,
      items,
      summary: {
        totalSchools: items.length,
        elementaryCount,
        middleCount,
        highCount,
        otherCount,
        totalStudents,
        totalTeachers,
        studentsPerTeacher,
        kindDistribution,
      },
    };
  } catch (err) {
    return {
      ...baseResult,
      fetched: true,
      error: err instanceof Error ? err.message : '학교알리미 API 조회 실패',
    };
  }
}

async function fetchDistrictStores(
  sggCode: string,
  numOfRows = 600
): Promise<Record<string, unknown>[]> {
  const apiKey = process.env.PUBLIC_DATA_API_KEY;
  if (!isConfigured(apiKey) || !sggCode) return [];

  try {
    const encodedKey = encodeServiceKey(apiKey.trim());
    const url = `https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInDong?serviceKey=${encodedKey}&pageNo=1&numOfRows=${numOfRows}&divId=signguCd&key=${encodeURIComponent(
      sggCode
    )}&type=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      header?: { resultCode?: string };
      body?: { items?: Record<string, unknown>[] };
    };
    if (json.header?.resultCode !== '00' || !Array.isArray(json.body?.items)) {
      return [];
    }
    return json.body.items;
  } catch {
    return [];
  }
}

async function reverseLookupRegionByCoords(
  lat: number,
  lng: number
): Promise<{
  sidoCode: string;
  sggCode: string;
  sidoName: string;
  sggName: string;
  dongName: string;
} | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = reverseRegionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // 1. Primary: Kakao Local coord2regioncode
  const kakaoRestKey = process.env.KAKAO_REST_API_KEY;
  if (isConfigured(kakaoRestKey)) {
    try {
      const url = `https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${lng}&y=${lat}`;
      const res = await fetch(url, {
        headers: { Authorization: `KakaoAK ${kakaoRestKey.trim()}` },
        signal: AbortSignal.timeout(4500),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          documents?: Array<{
            region_type?: string;
            code?: string;
            region_1depth_name?: string;
            region_2depth_name?: string;
            region_3depth_name?: string;
          }>;
        };
        const bDoc =
          json.documents?.find((d) => d.region_type === 'B') ??
          json.documents?.[0];
        const code = String(bDoc?.code ?? '').trim();
        if (code.length >= 5) {
          const sggCode = code.slice(0, 5);
          const sidoCode = sggCode.slice(0, 2);
          const sidoName =
            SIDO_NAMES_BY_CODE[sidoCode] ||
            String(bDoc?.region_1depth_name ?? '').trim();
          const sggName = String(bDoc?.region_2depth_name ?? '').trim();
          const dongName = String(bDoc?.region_3depth_name ?? '').trim();
          const result = { sidoCode, sggCode, sidoName, sggName, dongName };
          reverseRegionCache.set(cacheKey, {
            expiresAt: Date.now() + 1000 * 60 * 30,
            data: result,
          });
          return result;
        }
      }
    } catch {
      // Fallback to B553077 below
    }
  }

  // 2. Fallback: B553077 commercial store radius
  const apiKey = process.env.PUBLIC_DATA_API_KEY;
  if (!isConfigured(apiKey)) {
    return null;
  }

  const encodedKey = encodeServiceKey(apiKey.trim());
  for (const r of [1500, 4000]) {
    try {
      const url = `https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius?serviceKey=${encodedKey}&pageNo=1&numOfRows=5&radius=${r}&cx=${lng}&cy=${lat}&type=json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        header?: { resultCode?: string };
        body?: { items?: Record<string, unknown>[] };
      };
      const item = json.body?.items?.[0];
      if (!item) continue;
      const sggCode = String(item.signguCd ?? '').trim();
      const sidoCode =
        String(item.ctprvnCd ?? '').trim() ||
        (sggCode.length === 5 ? sggCode.slice(0, 2) : '');
      const sidoName =
        String(item.ctprvnNm ?? '').trim() ||
        SIDO_NAMES_BY_CODE[sidoCode] ||
        '';
      const sggName = String(item.signguNm ?? '').trim();
      const dongName = String(item.ldongNm ?? '').trim();
      if (sggCode.length === 5) {
        const result = { sidoCode, sggCode, sidoName, sggName, dongName };
        reverseRegionCache.set(cacheKey, {
          expiresAt: Date.now() + 1000 * 60 * 30,
          data: result,
        });
        return result;
      }
    } catch {
      continue;
    }
  }

  reverseRegionCache.set(cacheKey, {
    expiresAt: Date.now() + 1000 * 60 * 5,
    data: null,
  });
  return null;
}

async function lookupDistrictInfoBySggCode(sggCode: string): Promise<{
  sidoCode: string;
  sggCode: string;
  sidoName: string;
  sggName: string;
  lat: number | null;
  lng: number | null;
}> {
  const known = findRegionBySggCode(sggCode);
  if (known) {
    return {
      sidoCode: known.sido.sidoCode,
      sggCode: known.district.sggCode,
      sidoName: known.sido.name,
      sggName: known.district.name,
      lat: toNumberOrNull(known.district.defaultLat),
      lng: toNumberOrNull(known.district.defaultLng),
    };
  }

  const fallbackSidoCode = sggCode.length === 5 ? sggCode.slice(0, 2) : '';
  const fallbackSidoName = SIDO_NAMES_BY_CODE[fallbackSidoCode] ?? '';

  const stores = await fetchDistrictStores(sggCode, 150);
  if (stores.length > 0) {
    const first = stores[0];
    const sidoCode = String(first.ctprvnCd ?? '').trim() || fallbackSidoCode;
    const sidoName =
      String(first.ctprvnNm ?? '').trim() ||
      SIDO_NAMES_BY_CODE[sidoCode] ||
      fallbackSidoName;
    const sggName = String(first.signguNm ?? '').trim();

    if (sidoName && sggName) {
      const pt = await geocodeKoreaAddress(`${sidoName} ${sggName}`);
      if (pt) {
        return {
          sidoCode,
          sggCode,
          sidoName,
          sggName,
          lat: pt.lat,
          lng: pt.lng,
        };
      }
    }

    const lats = stores
      .map((r) => toNumberOrNull(r.lat))
      .filter((v): v is number => v !== null);
    const lngs = stores
      .map((r) => toNumberOrNull(r.lon))
      .filter((v): v is number => v !== null);
    if (lats.length > 0 && lngs.length > 0) {
      const avgLat = Number(
        (lats.reduce((a, b) => a + b, 0) / lats.length).toFixed(6)
      );
      const avgLng = Number(
        (lngs.reduce((a, b) => a + b, 0) / lngs.length).toFixed(6)
      );
      return {
        sidoCode,
        sggCode,
        sidoName,
        sggName,
        lat: avgLat,
        lng: avgLng,
      };
    }
  }

  const UNSPLIT_CITY_NAMES: Record<string, string> = {
    '41110': '수원시',
    '41130': '성남시',
    '41170': '안양시',
    '41190': '부천시',
    '41270': '안산시',
    '41280': '고양시',
    '41460': '용인시',
  };

  const legacyName = UNSPLIT_CITY_NAMES[sggCode];
  if (legacyName && fallbackSidoName) {
    const pt = await geocodeKoreaAddress(`${fallbackSidoName} ${legacyName}`);
    if (pt) {
      return {
        sidoCode: fallbackSidoCode,
        sggCode,
        sidoName: fallbackSidoName,
        sggName: legacyName,
        lat: pt.lat,
        lng: pt.lng,
      };
    }
  }

  return {
    sidoCode: fallbackSidoCode,
    sggCode,
    sidoName: fallbackSidoName,
    sggName: legacyName ?? '',
    lat: null,
    lng: null,
  };
}

const UNIVERSITY_HOSPITAL_REGEX =
  /(대학교|대학병원|세브란스|삼성서울|서울아산|성모병원|보라매|국립암센터|백병원|차의과학|차병원|을지대|연세대|고려대|서울대|한양대|경희대|중앙대|건국대|이대|순천향|인하대|가천대|길병원|아주대|단국대|충남대|충북대|전남대|전북대|경북대|부산대|동아대|계명대|영남대|울산대|조선대|원광대|한림대)/;

function cleanHospitalName(raw: string): string {
  return raw
    .replace(/[-_](암센터.*|외래.*|입원.*|모바일.*|주차장.*|수납.*|장례식장.*|어린이.*|소아.*|본원.*)$/i, '')
    .replace(/\s*(암센터외래|암센터입원|소아입원|본원외래|본원입원|주차장|장례식장)$/i, '')
    .trim();
}

async function fetchNearbyHospitals(params: {
  sggCode: string;
  centerLat: number | null;
  centerLng: number | null;
  radius: number;
}): Promise<HospitalRecord[]> {
  const apiKey = process.env.PUBLIC_DATA_API_KEY;
  if (!isConfigured(apiKey)) return [];

  const encodedKey = encodeServiceKey(apiKey.trim());
  const maxHospitalMeters = Math.max(params.radius, 3500);
  const searchRadius = maxHospitalMeters;

  const requests: Promise<Response>[] = [];
  if (params.sggCode) {
    requests.push(
      fetch(
        `https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInDong?serviceKey=${encodedKey}&pageNo=1&numOfRows=200&divId=signguCd&key=${encodeURIComponent(
          params.sggCode
        )}&indsSclsCd=Q10101&type=json`,
        { signal: AbortSignal.timeout(8000) }
      )
    );
  }
  if (params.centerLat !== null && params.centerLng !== null) {
    requests.push(
      fetch(
        `https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius?serviceKey=${encodedKey}&pageNo=1&numOfRows=1000&radius=${searchRadius}&cx=${params.centerLng}&cy=${params.centerLat}&indsLclsCd=Q1&type=json`,
        { signal: AbortSignal.timeout(8000) }
      )
    );
  }

  const results = await Promise.allSettled(requests);
  const rawRows: Record<string, unknown>[] = [];
  for (const res of results) {
    if (res.status !== 'fulfilled' || !res.value.ok) continue;
    try {
      const json = (await res.value.json()) as {
        body?: { items?: Record<string, unknown>[] };
      };
      if (Array.isArray(json.body?.items)) {
        rawRows.push(...json.body.items);
      }
    } catch {
      // Ignore malformed response
    }
  }

  const deduped: HospitalRecord[] = [];
  for (let idx = 0; idx < rawRows.length; idx += 1) {
    const row = rawRows[idx];
    const sclsCd = String(row.indsSclsCd ?? '').trim();
    const sclsNm = String(row.indsSclsNm ?? '').trim();
    const rawName = String(row.bizesNm ?? '').trim();
    if (!rawName) continue;

    // Exclude non-hospital administrative/parking/pharmacy/funeral sub-entries or pure clinics
    if (
      /(주차장|약국|장례식장|편의점|매점|카페|안경|식당|수납|모바일)/.test(rawName)
    ) {
      continue;
    }

    const isGeneral = sclsCd === 'Q10101' || sclsNm === '종합병원';
    const isUniversity = UNIVERSITY_HOSPITAL_REGEX.test(rawName);
    if (!isGeneral && !isUniversity) continue;
    // Skip minor diagnostic clinics carrying a hospital brand name (e.g. 강남의원)
    if (!isGeneral && /(의원|치과|한의원)$/.test(rawName)) continue;

    const lat = toNumberOrNull(row.lat);
    const lng = toNumberOrNull(row.lon);
    if (lat === null || lng === null) continue;

    const cleanName = cleanHospitalName(rawName);
    if (!cleanName) continue;

    const already = deduped.find((existing) => {
      if (existing.name === cleanName) return true;
      const distBetween = haversineMeters(existing.lat, existing.lng, lat, lng);
      const sameRoot =
        cleanName.includes(existing.name) || existing.name.includes(cleanName);
      return sameRoot && distBetween !== null && distBetween < 500;
    });
    if (already) continue;

    const distMeters = haversineMeters(
      params.centerLat,
      params.centerLng,
      lat,
      lng
    );
    if (distMeters !== null && distMeters > maxHospitalMeters) continue;

    deduped.push({
      id: String(row.bizesId ?? `hosp-${idx}`),
      name: cleanName,
      category: isUniversity ? '대학병원' : '종합병원',
      address: String(row.rdnmAdr ?? row.lnoAdr ?? '').trim(),
      lat,
      lng,
      distanceMeters: distMeters,
    });
  }

  deduped.sort((a, b) => {
    if (a.distanceMeters !== null && b.distanceMeters !== null) {
      return a.distanceMeters - b.distanceMeters;
    }
    return a.name.localeCompare(b.name, 'ko');
  });

  return deduped.slice(0, 20);
}

function expandKoreanSidoPrefix(addr: string): string {
  const trimmed = addr.trim();
  if (!trimmed) return '';
  const prefixes: Array<[RegExp, string]> = [
    [/^서울\s+/, '서울특별시 '],
    [/^부산\s+/, '부산광역시 '],
    [/^대구\s+/, '대구광역시 '],
    [/^인천\s+/, '인천광역시 '],
    [/^광주\s+/, '광주광역시 '],
    [/^대전\s+/, '대전광역시 '],
    [/^울산\s+/, '울산광역시 '],
    [/^세종(?:시)?\s+/, '세종특별자치시 '],
    [/^경기\s+/, '경기도 '],
    [/^강원(?:도)?\s+/, '강원특별자치도 '],
    [/^충북\s+/, '충청북도 '],
    [/^충남\s+/, '충청남도 '],
    [/^전북\s+/, '전북특별자치도 '],
    [/^전라북도\s+/, '전북특별자치도 '],
    [/^전남\s+/, '전라남도 '],
    [/^경북\s+/, '경상북도 '],
    [/^경남\s+/, '경상남도 '],
    [/^제주(?:도)?\s+/, '제주특별자치도 '],
  ];
  for (const [pattern, replacement] of prefixes) {
    if (pattern.test(trimmed)) {
      return trimmed.replace(pattern, replacement);
    }
  }
  return trimmed;
}

function extractDongFromLotAddress(lotAddr: string): string {
  const trimmed = lotAddr.trim();
  if (!trimmed) return '';
  const withoutLotNo = trimmed.replace(/\s+(?:산\s*)?\d+(?:-\d+)?$/, '').trim();
  const tokens = withoutLotNo.split(/\s+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (/(?:동|읍|면|가|리)$/.test(token) || /로\d*가?$/.test(token)) {
      return token;
    }
  }
  return '';
}

function formatKoreanFacilityAddress(
  roadAddr: string,
  lotAddr: string,
  facilityName: string
): string {
  const baseRaw = roadAddr.trim() || lotAddr.trim();
  if (!baseRaw) return '';
  const expanded = expandKoreanSidoPrefix(baseRaw);
  const dong = extractDongFromLotAddress(lotAddr);
  const parenParts = [dong, facilityName.trim()].filter(Boolean);
  if (parenParts.length === 0) return expanded;
  if (expanded.includes(`(${dong}`)) return expanded;
  return `${expanded} (${parenParts.join(', ')})`;
}

function formatNominatimKoreanAddress(
  addrObj: Record<string, string> | undefined,
  facilityName?: string
): string {
  if (!addrObj) return '';
  const province = expandKoreanSidoPrefix(`${addrObj.province ?? ''} `).trim();
  const city = expandKoreanSidoPrefix(`${addrObj.city ?? ''} `).trim();
  const borough = String(addrObj.borough ?? addrObj.county ?? '').trim();
  const road = String(addrObj.road ?? '').trim();
  const houseNumber = String(addrObj.house_number ?? '').trim();

  const dongRaw = String(
    addrObj.quarter ??
      addrObj.suburb ??
      addrObj.village ??
      addrObj.town ??
      addrObj.neighbourhood ??
      ''
  ).trim();
  const dong =
    dongRaw && dongRaw !== borough && dongRaw !== city ? dongRaw : '';

  const baseTokens: string[] = [];
  for (const part of [province, city, borough, road, houseNumber]) {
    const clean = part.trim();
    if (!clean) continue;
    if (!baseTokens.includes(clean)) {
      baseTokens.push(clean);
    }
  }

  const base = baseTokens.join(' ');
  const parenParts = [dong, (facilityName ?? '').trim()].filter(Boolean);
  if (!base) {
    return parenParts.join(', ');
  }
  if (parenParts.length === 0) return base;
  return `${base} (${parenParts.join(', ')})`;
}

function stripKakaoSubwayLineSuffix(placeName: string): {
  stationName: string;
  extractedLine: string;
} {
  const trimmed = placeName.trim();
  const match = trimmed.match(
    /^(.+?역)\s+((?:수도권)?[0-9]+호선|수인분당선|분당선|용인에버라인|에버라인|경강선|경의중앙선|경춘선|공항철도|신분당선|김포골드라인|우이신설선|신림선|서해선|동해선|대경선|GTX-[A-Z0-9]+|인천[0-9]+호선|부산[0-9]+호선|대구[0-9]+호선|광주[0-9]+호선|대전[0-9]+호선.*)$/i
  );
  if (match) {
    return {
      stationName: match[1].trim(),
      extractedLine: match[2].trim(),
    };
  }
  return {
    stationName: trimmed.endsWith('역') ? trimmed : `${trimmed}역`,
    extractedLine: '',
  };
}

async function fetchNearbySubwayStations(params: {
  centerLat: number | null;
  centerLng: number | null;
  radius: number;
}): Promise<SubwayStationRecord[]> {
  if (params.centerLat === null || params.centerLng === null) return [];

  const searchMeters = Math.min(
    Math.max(Math.round(params.radius * 1.2), 1800),
    4000
  );
  const cacheKey = `${params.centerLat.toFixed(3)},${params.centerLng.toFixed(3)}:${searchMeters}`;
  const cached = subwayCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items.map((s) => ({
      ...s,
      distanceMeters: haversineMeters(
        params.centerLat,
        params.centerLng,
        s.lat,
        s.lng
      ),
    }));
  }

  const stations: SubwayStationRecord[] = [];
  const kakaoRestKey = process.env.KAKAO_REST_API_KEY;

  if (isConfigured(kakaoRestKey)) {
    try {
      for (let page = 1; page <= 2; page++) {
        const url = new URL(
          'https://dapi.kakao.com/v2/local/search/category.json'
        );
        url.searchParams.set('category_group_code', 'SW8');
        url.searchParams.set('x', String(params.centerLng));
        url.searchParams.set('y', String(params.centerLat));
        url.searchParams.set('radius', String(searchMeters));
        url.searchParams.set('sort', 'distance');
        url.searchParams.set('size', '15');
        url.searchParams.set('page', String(page));

        const res = await fetch(url.toString(), {
          headers: {
            Authorization: `KakaoAK ${kakaoRestKey.trim()}`,
          },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) break;

        const json = (await res.json()) as {
          meta?: { is_end?: boolean };
          documents?: Array<{
            id?: string;
            place_name?: string;
            category_name?: string;
            road_address_name?: string;
            address_name?: string;
            x?: string;
            y?: string;
            distance?: string;
          }>;
        };

        for (const doc of json.documents ?? []) {
          const rawPlace = String(doc.place_name ?? '').trim();
          if (!rawPlace) continue;
          const { stationName, extractedLine } =
            stripKakaoSubwayLineSuffix(rawPlace);
          const lat = toNumberOrNull(doc.y);
          const lng = toNumberOrNull(doc.x);
          if (lat === null || lng === null) continue;

          const distMeters =
            toNumberOrNull(doc.distance) ??
            haversineMeters(params.centerLat, params.centerLng, lat, lng);
          if (distMeters !== null && distMeters > searchMeters * 1.15) continue;

          const categoryLeaf = String(doc.category_name ?? '')
            .split('>')
            .pop()
            ?.trim();
          const lineOrOperator =
            categoryLeaf || extractedLine || '도시철도';

          const cleanAddress = formatKoreanFacilityAddress(
            String(doc.road_address_name ?? ''),
            String(doc.address_name ?? ''),
            stationName
          );

          const existing = stations.find((s) => {
            if (s.name !== stationName) return false;
            const gap = haversineMeters(s.lat, s.lng, lat, lng);
            return gap !== null && gap < 600;
          });

          if (existing) {
            if (
              lineOrOperator &&
              existing.lineOrOperator &&
              !existing.lineOrOperator.includes(lineOrOperator)
            ) {
              existing.lineOrOperator = `${existing.lineOrOperator} · ${lineOrOperator}`;
            }
            if (!existing.address && cleanAddress) {
              existing.address = cleanAddress;
            }
            continue;
          }

          stations.push({
            id: `sub-${doc.id ?? stations.length}`,
            name: stationName,
            lineOrOperator,
            address: cleanAddress,
            lat,
            lng,
            distanceMeters: distMeters,
          });
        }

        if (json.meta?.is_end !== false) break;
      }
    } catch {
      // Fallback to Nominatim below if needed
    }
  }

  if (stations.length === 0) {
    try {
      const dLat = searchMeters / 111320;
      const dLng =
        searchMeters / (111320 * Math.cos((params.centerLat * Math.PI) / 180));
      const minLng = params.centerLng - dLng;
      const maxLng = params.centerLng + dLng;
      const minLat = params.centerLat - dLat;
      const maxLat = params.centerLat + dLat;

      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', '50');
      url.searchParams.set('countrycodes', 'kr');
      url.searchParams.set('bounded', '1');
      url.searchParams.set('viewbox', `${minLng},${maxLat},${maxLng},${minLat}`);
      url.searchParams.set('q', 'station');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('extratags', '1');
      url.searchParams.set('accept-language', 'ko');

      const res = await fetch(url.toString(), {
        headers: {
          'User-Agent': 'GeoSiteRealEstateAnalysis/1.0',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(7000),
      });
      if (res.ok) {
        const rows = (await res.json()) as Array<{
          place_id?: number;
          name?: string;
          display_name?: string;
          class?: string;
          type?: string;
          lat?: string;
          lon?: string;
          address?: Record<string, string>;
          extratags?: Record<string, string>;
        }>;

        for (const row of rows) {
          if (row.class !== 'railway') continue;
          if (row.type !== 'station' && row.type !== 'halt') continue;

          const rawName = String(row.name ?? '').trim();
          if (!rawName) continue;
          const stationName = rawName.endsWith('역') ? rawName : `${rawName}역`;
          const lat = toNumberOrNull(row.lat);
          const lng = toNumberOrNull(row.lon);
          if (lat === null || lng === null) continue;

          const distMeters = haversineMeters(
            params.centerLat,
            params.centerLng,
            lat,
            lng
          );
          if (distMeters !== null && distMeters > searchMeters * 1.2) continue;

          const extra = row.extratags ?? {};
          const network = String(
            extra['network:ko'] ?? extra.network ?? ''
          ).trim();
          const operator = String(
            extra['operator:ko'] ?? extra.operator ?? ''
          ).trim();
          const desc = String(extra.description ?? '').trim();
          const lineOrOperator =
            desc ||
            [network, operator].filter(Boolean).join(' · ') ||
            (extra.station === 'light_rail' ? '경전철' : '도시철도');

          const existing = stations.find((s) => {
            if (s.name !== stationName) return false;
            const gap = haversineMeters(s.lat, s.lng, lat, lng);
            return gap !== null && gap < 600;
          });

          if (existing) {
            if (
              lineOrOperator &&
              existing.lineOrOperator &&
              !existing.lineOrOperator.includes(lineOrOperator)
            ) {
              existing.lineOrOperator = `${existing.lineOrOperator} · ${lineOrOperator}`;
            }
            continue;
          }

          stations.push({
            id: `sub-${row.place_id ?? stations.length}`,
            name: stationName,
            lineOrOperator,
            address: formatNominatimKoreanAddress(row.address, stationName),
            lat,
            lng,
            distanceMeters: distMeters,
          });
        }
      }
    } catch {
      return [];
    }
  }

  stations.sort((a, b) => {
    if (a.distanceMeters !== null && b.distanceMeters !== null) {
      return a.distanceMeters - b.distanceMeters;
    }
    return a.name.localeCompare(b.name, 'ko');
  });

  subwayCache.set(cacheKey, {
    expiresAt: Date.now() + 1000 * 60 * 30,
    items: stations,
  });
  return stations;
}

async function fetchNearbyBusStops(params: {
  centerLat: number | null;
  centerLng: number | null;
  radius: number;
}): Promise<BusStopRecord[]> {
  if (params.centerLat === null || params.centerLng === null) return [];

  const searchMeters = Math.min(
    Math.max(Math.round(params.radius * 1.15), 800),
    2500
  );
  const cacheKey = `${params.centerLat.toFixed(3)},${params.centerLng.toFixed(3)}:${searchMeters}`;
  const cached = busStopCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items.map((b) => ({
      ...b,
      distanceMeters: haversineMeters(
        params.centerLat,
        params.centerLng,
        b.lat,
        b.lng
      ),
    }));
  }

  try {
    const dLat = searchMeters / 111320;
    const dLng =
      searchMeters / (111320 * Math.cos((params.centerLat * Math.PI) / 180));
    const minLng = params.centerLng - dLng;
    const maxLng = params.centerLng + dLng;
    const minLat = params.centerLat - dLat;
    const maxLat = params.centerLat + dLat;

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '50');
    url.searchParams.set('countrycodes', 'kr');
    url.searchParams.set('bounded', '1');
    url.searchParams.set('viewbox', `${minLng},${maxLat},${maxLng},${minLat}`);
    url.searchParams.set('q', 'bus stop');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('extratags', '1');
    url.searchParams.set('accept-language', 'ko');

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'GeoSiteRealEstateAnalysis/1.0',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return [];

    const rows = (await res.json()) as Array<{
      place_id?: number;
      name?: string;
      class?: string;
      type?: string;
      lat?: string;
      lon?: string;
      address?: Record<string, string>;
      extratags?: Record<string, string>;
    }>;

    const stops: BusStopRecord[] = [];
    for (const row of rows) {
      if (row.class !== 'highway' || row.type !== 'bus_stop') continue;

      const stopName = String(row.name ?? '').trim();
      if (!stopName) continue;
      const lat = toNumberOrNull(row.lat);
      const lng = toNumberOrNull(row.lon);
      if (lat === null || lng === null) continue;

      const distMeters = haversineMeters(
        params.centerLat,
        params.centerLng,
        lat,
        lng
      );
      if (distMeters !== null && distMeters > searchMeters * 1.1) continue;

      const existing = stops.find((b) => {
        if (b.name !== stopName) return false;
        const gap = haversineMeters(b.lat, b.lng, lat, lng);
        return gap !== null && gap < 15;
      });
      if (existing) continue;

      const extra = row.extratags ?? {};
      const rawRouteRef = String(extra.route_ref ?? '')
        .split(';')
        .map((r) => r.trim())
        .filter(Boolean)
        .join(', ');
      const network = String(
        extra['network:ko'] ?? extra.network ?? ''
      ).trim();

      const routes =
        rawRouteRef && network
          ? `${network} (${rawRouteRef})`
          : rawRouteRef || network || '';

      stops.push({
        id: `bus-${row.place_id ?? stops.length}`,
        name: stopName,
        routes,
        address: formatNominatimKoreanAddress(row.address, stopName),
        lat,
        lng,
        distanceMeters: distMeters,
      });
    }

    stops.sort((a, b) => {
      if (a.distanceMeters !== null && b.distanceMeters !== null) {
        return a.distanceMeters - b.distanceMeters;
      }
      return a.name.localeCompare(b.name, 'ko');
    });

    busStopCache.set(cacheKey, {
      expiresAt: Date.now() + 1000 * 60 * 30,
      items: stops,
    });
    return stops;
  } catch {
    return [];
  }
}

async function fetchKaptComplexList(
  sggCode: string
): Promise<ComplexOption[]> {
  const apiKey = process.env.PUBLIC_DATA_API_KEY;
  if (!isConfigured(apiKey) || !sggCode) return [];

  try {
    const encodedKey = encodeServiceKey(apiKey.trim());
    const url = `https://apis.data.go.kr/1613000/AptListService4/getSigunguAptList4?serviceKey=${encodedKey}&sigunguCode=${encodeURIComponent(
      sggCode
    )}&numOfRows=500&pageNo=1`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      response?: {
        header?: { resultCode?: string };
        body?: { items?: Record<string, unknown>[] };
      };
    };
    const items = json.response?.body?.items;
    if (!Array.isArray(items)) return [];

    return items
      .map((row) => ({
        name: String(row.kaptName ?? '').trim(),
        dongName: String(row.as3 ?? '').trim(),
        jibun: '',
        roadAddress: '',
        type: 'apt' as const,
      }))
      .filter((c) => Boolean(c.name));
  } catch {
    return [];
  }
}

async function fetchCommercial(params: {
  lat: string;
  lng: string;
  radius: number;
  dongCode: string;
}): Promise<DatasetResult<CommercialStoreRecord, CommercialSummary>> {
  const apiKey = process.env.PUBLIC_DATA_API_KEY;
  const baseResult: DatasetResult<CommercialStoreRecord, CommercialSummary> = {
    configured: isConfigured(apiKey),
    fetched: false,
    envVarName: 'PUBLIC_DATA_API_KEY',
    sourceName: '소상공인시장진흥공단 상가(상권)정보 API',
    items: [],
    summary: null,
    error: null,
  };

  if (!isConfigured(apiKey)) {
    return baseResult;
  }

  try {
    const encodedKey = encodeServiceKey(apiKey.trim());
    const centerLat = toNumberOrNull(params.lat);
    const centerLng = toNumberOrNull(params.lng);

    let endpointUrl = '';
    if (params.dongCode.trim().length >= 8) {
      endpointUrl = `https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInDong?serviceKey=${encodedKey}&pageNo=1&numOfRows=500&divId=adongCd&key=${encodeURIComponent(
        params.dongCode.trim()
      )}&type=json`;
    } else if (centerLat !== null && centerLng !== null) {
      endpointUrl = `https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius?serviceKey=${encodedKey}&pageNo=1&numOfRows=500&radius=${params.radius}&cx=${centerLng}&cy=${centerLat}&type=json`;
    } else {
      return {
        ...baseResult,
        fetched: false,
        error: '상권 조회를 위한 기준 좌표가 확인되지 않았습니다.',
      };
    }

    const response = await fetch(endpointUrl, {
      signal: AbortSignal.timeout(12000),
    });

    const text = await response.text();
    let parsedJson: {
      header?: { resultCode?: string; resultMsg?: string };
      body?: { items?: Record<string, unknown>[]; totalCount?: number };
      OpenAPI_ServiceResponse?: {
        cmmMsgHeader?: { errMsg?: string; returnAuthMsg?: string };
      };
    } | null = null;

    try {
      parsedJson = JSON.parse(text);
    } catch {
      const parsedXml = xmlParser.parse(text) as {
        OpenAPI_ServiceResponse?: {
          cmmMsgHeader?: { errMsg?: string; returnAuthMsg?: string };
        };
      };
      const authMsg =
        parsedXml?.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnAuthMsg ||
        parsedXml?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg;
      throw new Error(
        authMsg
          ? `공공상가정보 API 오류: ${authMsg}`
          : `공공상가정보 API 응답 오류 (${response.status})`
      );
    }

    if (parsedJson?.OpenAPI_ServiceResponse?.cmmMsgHeader) {
      const hdr = parsedJson.OpenAPI_ServiceResponse.cmmMsgHeader;
      throw new Error(
        `공공상가정보 API 오류: ${hdr.returnAuthMsg || hdr.errMsg || response.status}`
      );
    }

    if (!response.ok) {
      throw new Error(`공공상가정보 API 응답 오류 (${response.status})`);
    }

    const resultCode = parsedJson?.header?.resultCode;
    if (resultCode && resultCode !== '00' && resultCode !== '03') {
      throw new Error(parsedJson?.header?.resultMsg || `API 오류 (${resultCode})`);
    }

    const rawItems = Array.isArray(parsedJson?.body?.items)
      ? parsedJson.body.items
      : [];

    const items: CommercialStoreRecord[] = rawItems.map((row, idx) => {
      const lat = toNumberOrNull(row.lat);
      const lng = toNumberOrNull(row.lon);
      return {
        id: String(row.bizesId ?? `store-${idx}`),
        name: String(row.bizesNm ?? ''),
        branchName: String(row.brchNm ?? ''),
        largeCategoryCode: String(row.indsLclsCd ?? ''),
        largeCategoryName: String(row.indsLclsNm ?? ''),
        mediumCategoryName: String(row.indsMclsNm ?? ''),
        smallCategoryName: String(row.indsSclsNm ?? ''),
        roadAddress: String(row.rdnmAdr ?? ''),
        lotAddress: String(row.lnoAdr ?? ''),
        dongName: String(row.ldongNm ?? row.adongNm ?? ''),
        floor: String(row.flrNo ?? ''),
        lat,
        lng,
        distanceMeters: haversineMeters(centerLat, centerLng, lat, lng),
      };
    });

    if (items.length === 0) {
      return {
        ...baseResult,
        fetched: true,
        items: [],
        summary: null,
      };
    }

    const catMap = new Map<string, number>();
    let firstFloorCount = 0;
    let upperFloorCount = 0;
    let basementCount = 0;
    let unknownFloorCount = 0;

    for (const store of items) {
      const cat = store.largeCategoryName || '기타';
      catMap.set(cat, (catMap.get(cat) ?? 0) + 1);

      const flr = store.floor.trim().toUpperCase();
      if (!flr) {
        unknownFloorCount += 1;
      } else if (flr.startsWith('B') || flr.includes('지하') || flr.startsWith('-')) {
        basementCount += 1;
      } else if (flr === '1' || flr === '1층') {
        firstFloorCount += 1;
      } else {
        upperFloorCount += 1;
      }
    }

    const totalStores = items.length;
    const categoryDistribution: CategoryStat[] = Array.from(catMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([categoryName, count]) => ({
        categoryName,
        count,
        ratio: Number(((count / totalStores) * 100).toFixed(1)),
      }));

    const floorDistribution: FloorStat[] = [
      {
        label: '1층',
        count: firstFloorCount,
        ratio: Number(((firstFloorCount / totalStores) * 100).toFixed(1)),
      },
      {
        label: '2층 이상',
        count: upperFloorCount,
        ratio: Number(((upperFloorCount / totalStores) * 100).toFixed(1)),
      },
      {
        label: '지하층',
        count: basementCount,
        ratio: Number(((basementCount / totalStores) * 100).toFixed(1)),
      },
    ];
    if (unknownFloorCount > 0) {
      floorDistribution.push({
        label: '미상',
        count: unknownFloorCount,
        ratio: Number(((unknownFloorCount / totalStores) * 100).toFixed(1)),
      });
    }

    const radiusKm = params.radius / 1000;
    const areaSqKm = Math.PI * radiusKm * radiusKm;
    const densityPerSqKm =
      params.dongCode.trim().length < 8 && areaSqKm > 0
        ? Number((totalStores / areaSqKm).toFixed(1))
        : null;

    const topCategory = categoryDistribution[0] ?? null;

    return {
      ...baseResult,
      fetched: true,
      items,
      summary: {
        totalStores,
        densityPerSqKm,
        firstFloorCount,
        firstFloorRatio: Number(((firstFloorCount / totalStores) * 100).toFixed(1)),
        topCategoryName: topCategory ? topCategory.categoryName : null,
        topCategoryRatio: topCategory ? topCategory.ratio : null,
        categoryDistribution,
        floorDistribution,
      },
    };
  } catch (err) {
    return {
      ...baseResult,
      fetched: true,
      error: err instanceof Error ? err.message : '공공상가정보 API 조회 실패',
    };
  }
}

function summarizeTransactions(items: TransactionRecord[]): TransactionSummary | null {
  if (items.length === 0) return null;

  const prices = items
    .map((i) => i.priceMan)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const rents = items
    .map((i) => i.monthlyRentMan)
    .filter((v): v is number => v !== null);
  const areas = items
    .map((i) => i.areaSqm)
    .filter((v): v is number => v !== null);
  const unitPrices = items
    .map((i) => i.pricePerSqmMan)
    .filter((v): v is number => v !== null);

  const avgPriceMan =
    prices.length > 0
      ? Math.round(prices.reduce((acc, v) => acc + v, 0) / prices.length)
      : null;
  const medianPriceMan =
    prices.length > 0
      ? prices.length % 2 === 1
        ? prices[Math.floor(prices.length / 2)]
        : Math.round(
            (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
          )
      : null;
  const avgMonthlyRentMan =
    rents.length > 0
      ? Math.round(rents.reduce((acc, v) => acc + v, 0) / rents.length)
      : null;
  const avgAreaSqm =
    areas.length > 0
      ? Number((areas.reduce((acc, v) => acc + v, 0) / areas.length).toFixed(1))
      : null;
  const avgPricePerSqmMan =
    unitPrices.length > 0
      ? Number(
          (unitPrices.reduce((acc, v) => acc + v, 0) / unitPrices.length).toFixed(1)
        )
      : null;

  return {
    totalTransactions: items.length,
    avgPriceMan,
    medianPriceMan,
    avgMonthlyRentMan,
    avgAreaSqm,
    avgPricePerSqmMan,
    minPriceMan: prices.length > 0 ? prices[0] : null,
    maxPriceMan: prices.length > 0 ? prices[prices.length - 1] : null,
  };
}

function getMolitEndpointConfig(propertyType: PropertyType): {
  url: string;
  sourceName: string;
} {
  switch (propertyType) {
    case 'aptRent':
      return {
        url: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent',
        sourceName: '국토교통부 아파트 전월세 실거래가 API',
      };
    case 'officetel':
      return {
        url: 'https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade',
        sourceName: '국토교통부 오피스텔 매매 실거래가 API',
      };
    case 'officetelRent':
      return {
        url: 'https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent',
        sourceName: '국토교통부 오피스텔 전월세 실거래가 API',
      };
    case 'rowhouse':
      return {
        url: 'https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade2/getRTMSDataSvcRHTrade2',
        sourceName: '국토교통부 연립·다세대 매매 실거래가 API',
      };
    case 'rowhouseRent':
      return {
        url: 'https://apis.data.go.kr/1613000/RTMSDataSvcRHRent/getRTMSDataSvcRHRent',
        sourceName: '국토교통부 연립·다세대 전월세 실거래가 API',
      };
    case 'detached':
      return {
        url: 'https://apis.data.go.kr/1613000/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade',
        sourceName: '국토교통부 단독·다가구 매매 실거래가 API',
      };
    case 'detachedRent':
      return {
        url: 'https://apis.data.go.kr/1613000/RTMSDataSvcSHRent/getRTMSDataSvcSHRent',
        sourceName: '국토교통부 단독·다가구 전월세 실거래가 API',
      };
    case 'commercial':
      return {
        url: 'https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade',
        sourceName: '국토교통부 상업·업무용 매매 실거래가 API',
      };
    case 'land':
      return {
        url: 'https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade',
        sourceName: '국토교통부 토지 매매 실거래가 API',
      };
    case 'apt':
    default:
      return {
        url: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
        sourceName: '국토교통부 아파트 매매 실거래가 API',
      };
  }
}

async function fetchTransactions(params: {
  lawdCd: string;
  dealYmd: string;
  propertyType: PropertyType;
  dongName?: string;
  complexName?: string;
}): Promise<DatasetResult<TransactionRecord, TransactionSummary>> {
  const apiKey = process.env.PUBLIC_DATA_API_KEY || process.env.MOLIT_API_KEY;
  const endpointCfg = getMolitEndpointConfig(params.propertyType);

  const baseResult: DatasetResult<TransactionRecord, TransactionSummary> = {
    configured: isConfigured(apiKey),
    fetched: false,
    envVarName: 'PUBLIC_DATA_API_KEY',
    sourceName: endpointCfg.sourceName,
    items: [],
    summary: null,
    error: null,
  };

  if (!isConfigured(apiKey)) {
    return baseResult;
  }

  try {
    const encodedKey = encodeServiceKey(apiKey.trim());
    const url = `${endpointCfg.url}?serviceKey=${encodedKey}&LAWD_CD=${encodeURIComponent(
      params.lawdCd
    )}&DEAL_YMD=${encodeURIComponent(params.dealYmd)}&numOfRows=300&pageNo=1`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(12000),
    });

    const xmlText = await response.text();
    const parsed = xmlParser.parse(xmlText) as {
      response?: {
        header?: { resultCode?: string; resultMsg?: string };
        body?: { items?: { item?: Record<string, unknown> | Record<string, unknown>[] } };
      };
      OpenAPI_ServiceResponse?: {
        cmmMsgHeader?: { errMsg?: string; returnAuthMsg?: string };
      };
    };

    if (parsed.OpenAPI_ServiceResponse?.cmmMsgHeader) {
      const hdr = parsed.OpenAPI_ServiceResponse.cmmMsgHeader;
      throw new Error(
        `실거래가 API 오류: ${hdr.returnAuthMsg || hdr.errMsg || response.status}`
      );
    }

    if (!response.ok) {
      throw new Error(`실거래가 API 응답 오류 (${response.status})`);
    }

    const resultCode = parsed.response?.header?.resultCode;
    if (resultCode && resultCode !== '00' && resultCode !== '000') {
      throw new Error(parsed.response?.header?.resultMsg || `API 오류 (${resultCode})`);
    }

    const rawItemNode = parsed.response?.body?.items?.item;
    const rawItems = Array.isArray(rawItemNode)
      ? rawItemNode
      : rawItemNode
        ? [rawItemNode]
        : [];

    const allItems: TransactionRecord[] = rawItems.map((row, idx) => {
      const isRent =
        params.propertyType === 'aptRent' ||
        params.propertyType === 'officetelRent' ||
        params.propertyType === 'rowhouseRent' ||
        params.propertyType === 'detachedRent';
      const priceMan = isRent
        ? toNumberOrNull(row.deposit ?? row['보증금액'])
        : toNumberOrNull(row.dealAmount ?? row['거래금액']);
      const monthlyRentMan = isRent
        ? toNumberOrNull(row.monthlyRent ?? row['월세금액'])
        : null;
      const areaSqm = toNumberOrNull(
        row.excluUseAr ??
          row.totalFloorAr ??
          row.buildingAr ??
          row.dealArea ??
          row['전용면적'] ??
          row['연면적'] ??
          row['건물면적'] ??
          row['거래면적']
      );
      const plottageAreaSqm = toNumberOrNull(
        row.plottageAr ?? row.landAr ?? row['대지면적']
      );
      const pricePerSqmMan =
        priceMan !== null && areaSqm !== null && areaSqm > 0
          ? Number((priceMan / areaSqm).toFixed(1))
          : null;

      const year = String(row.dealYear ?? row['년'] ?? '').trim();
      const month = String(row.dealMonth ?? row['월'] ?? '')
        .trim()
        .padStart(2, '0');
      const day = String(row.dealDay ?? row['일'] ?? '')
        .trim()
        .padStart(2, '0');
      const dealDate = year && month ? `${year}-${month}${day ? `-${day}` : ''}` : '';

      const jimok = String(row.jimok ?? row['지목'] ?? '').trim();
      const landUse = String(row.landUse ?? row['용도지역'] ?? '').trim();

      let propertyName = String(
        row.aptNm ??
          row.offiNm ??
          row.mhouseNm ??
          row.buildingUse ??
          row['아파트'] ??
          row['연립다세대'] ??
          row['단지'] ??
          ''
      ).trim();

      if (params.propertyType === 'land') {
        propertyName = [jimok, landUse].filter(Boolean).join(' · ') || '토지';
      } else if (params.propertyType === 'commercial') {
        const bUse = String(row.buildingUse ?? '').trim();
        const bType = String(row.buildingType ?? '').trim();
        propertyName = [bUse, bType].filter(Boolean).join(' · ') || '상업·업무용';
      } else if (
        params.propertyType === 'detached' ||
        params.propertyType === 'detachedRent'
      ) {
        propertyName = String(row.houseType ?? '').trim() || '단독·다가구';
      }

      const buildingUse =
        params.propertyType === 'officetel'
          ? '오피스텔 매매'
          : params.propertyType === 'officetelRent'
            ? monthlyRentMan && monthlyRentMan > 0
              ? '오피스텔 월세'
              : '오피스텔 전세'
            : params.propertyType === 'apt'
              ? '아파트 매매'
              : params.propertyType === 'aptRent'
                ? monthlyRentMan && monthlyRentMan > 0
                  ? '아파트 월세'
                  : '아파트 전세'
                : params.propertyType === 'rowhouse'
                  ? String(row.houseType ?? '연립·다세대').trim()
                  : params.propertyType === 'rowhouseRent'
                    ? `${String(row.houseType ?? '연립·다세대').trim()} ${
                        monthlyRentMan && monthlyRentMan > 0 ? '월세' : '전세'
                      }`
                    : params.propertyType === 'detached'
                      ? String(row.houseType ?? '단독·다가구').trim()
                      : params.propertyType === 'detachedRent'
                        ? `${String(row.houseType ?? '단독·다가구').trim()} ${
                            monthlyRentMan && monthlyRentMan > 0 ? '월세' : '전세'
                          }`
                        : params.propertyType === 'land'
                          ? jimok || '토지'
                          : String(row.buildingUse ?? '상업·업무용').trim();

      return {
        id: `tx-${idx}`,
        propertyName,
        dongName: String(row.umdNm ?? row['법정동'] ?? '').trim(),
        jibun: String(row.jibun ?? row['지번'] ?? '').trim(),
        roadAddress: formatRoadAddress(row),
        areaSqm,
        plottageAreaSqm,
        priceMan,
        monthlyRentMan,
        pricePerSqmMan,
        dealDate,
        floor: String(row.floor ?? row['층'] ?? '').trim(),
        buildYear: String(row.buildYear ?? row['건축년도'] ?? '').trim(),
        buildingUse,
        jimok,
        landUse,
        contractType: String(row.contractType ?? row.dealingGbn ?? '').trim(),
      };
    });

    const filteredItems = allItems.filter((item) => {
      if (params.dongName && item.dongName !== params.dongName) {
        return false;
      }
      if (
        params.complexName &&
        (params.propertyType === 'apt' ||
          params.propertyType === 'aptRent' ||
          params.propertyType === 'officetel' ||
          params.propertyType === 'officetelRent') &&
        item.propertyName !== params.complexName
      ) {
        return false;
      }
      return true;
    });

    return {
      ...baseResult,
      fetched: true,
      items: filteredItems,
      summary: summarizeTransactions(filteredItems),
    };
  } catch (err) {
    return {
      ...baseResult,
      fetched: true,
      error: err instanceof Error ? err.message : '실거래가 API 조회 실패',
    };
  }
}

async function fetchRegionOptions(params: {
  sidoCode: string;
  sggCode: string;
  dealYmd: string;
}): Promise<RegionOptionsResponse> {
  const cacheKey = `${params.sggCode}:${params.dealYmd}`;
  const cached = regionOptionsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const [kaptRes, aptRes, rentRes, offiRes, offiRentRes, storeRows] =
    await Promise.allSettled([
      fetchKaptComplexList(params.sggCode),
      fetchTransactions({
        lawdCd: params.sggCode,
        dealYmd: params.dealYmd,
        propertyType: 'apt',
      }),
      fetchTransactions({
        lawdCd: params.sggCode,
        dealYmd: params.dealYmd,
        propertyType: 'aptRent',
      }),
      fetchTransactions({
        lawdCd: params.sggCode,
        dealYmd: params.dealYmd,
        propertyType: 'officetel',
      }),
      fetchTransactions({
        lawdCd: params.sggCode,
        dealYmd: params.dealYmd,
        propertyType: 'officetelRent',
      }),
      fetchDistrictStores(params.sggCode, 600),
    ]);

  const dongSet = new Set<string>();
  const complexMap = new Map<string, ComplexOption>();

  const upsertComplex = (c: ComplexOption) => {
    if (!c.name) return;
    if (c.dongName) dongSet.add(c.dongName);
    const key = `${c.type}:${c.dongName}:${c.name}`;
    const existing = complexMap.get(key);
    if (!existing) {
      complexMap.set(key, c);
    } else {
      if (!existing.roadAddress && c.roadAddress) {
        existing.roadAddress = c.roadAddress;
      }
      if (!existing.jibun && c.jibun) {
        existing.jibun = c.jibun;
      }
    }
  };

  if (kaptRes.status === 'fulfilled') {
    for (const c of kaptRes.value) {
      upsertComplex(c);
    }
  }

  if (aptRes.status === 'fulfilled') {
    for (const item of aptRes.value.items) {
      if (item.dongName) dongSet.add(item.dongName);
      if (item.propertyName) {
        upsertComplex({
          name: item.propertyName,
          dongName: item.dongName,
          jibun: item.jibun,
          roadAddress: item.roadAddress,
          type: 'apt',
        });
      }
    }
  }

  if (rentRes.status === 'fulfilled') {
    for (const item of rentRes.value.items) {
      if (item.dongName) dongSet.add(item.dongName);
      if (item.propertyName) {
        upsertComplex({
          name: item.propertyName,
          dongName: item.dongName,
          jibun: item.jibun,
          roadAddress: item.roadAddress,
          type: 'apt',
        });
      }
    }
  }

  if (offiRes.status === 'fulfilled') {
    for (const item of offiRes.value.items) {
      if (item.dongName) dongSet.add(item.dongName);
      if (item.propertyName) {
        upsertComplex({
          name: item.propertyName,
          dongName: item.dongName,
          jibun: item.jibun,
          roadAddress: item.roadAddress,
          type: 'officetel',
        });
      }
    }
  }

  if (offiRentRes.status === 'fulfilled') {
    for (const item of offiRentRes.value.items) {
      if (item.dongName) dongSet.add(item.dongName);
      if (item.propertyName) {
        upsertComplex({
          name: item.propertyName,
          dongName: item.dongName,
          jibun: item.jibun,
          roadAddress: item.roadAddress,
          type: 'officetel',
        });
      }
    }
  }

  if (storeRows.status === 'fulfilled') {
    for (const row of storeRows.value) {
      const ldong = String(row.ldongNm ?? '').trim();
      if (ldong) dongSet.add(ldong);
    }
  }

  const dongs = Array.from(dongSet).sort((a, b) => a.localeCompare(b, 'ko'));
  const complexes = Array.from(complexMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'ko')
  );

  const data: RegionOptionsResponse = { dongs, complexes };
  regionOptionsCache.set(cacheKey, {
    expiresAt: Date.now() + 1000 * 60 * 10,
    data,
  });
  return data;
}

async function resolveTargetLocation(params: {
  sidoCode: string;
  sggCode: string;
  dongName: string;
  complexName: string;
  propertyType: PropertyType;
  dealYmd: string;
  fallbackLat: string;
  fallbackLng: string;
  manualCoords?: boolean;
}): Promise<{
  resolvedLocation: ResolvedLocationInfo;
  effectiveSidoCode: string;
  effectiveSggCode: string;
}> {
  const normalizedSido =
    params.sggCode.length === 5 ? params.sggCode.slice(0, 2) : params.sidoCode;

  const districtInfo = await lookupDistrictInfoBySggCode(params.sggCode);
  const effectiveSidoCode = districtInfo.sidoCode || normalizedSido;
  const effectiveSggCode = districtInfo.sggCode || params.sggCode;
  const sidoName = districtInfo.sidoName || SIDO_NAMES_BY_CODE[effectiveSidoCode] || '';
  const sggName = districtInfo.sggName;
  const regionPrefix = [sidoName, sggName].filter(Boolean).join(' ');

  const fallbackLatNum = toNumberOrNull(params.fallbackLat);
  const fallbackLngNum = toNumberOrNull(params.fallbackLng);

  if (params.manualCoords && fallbackLatNum !== null && fallbackLngNum !== null) {
    const rev = await reverseLookupRegionByCoords(fallbackLatNum, fallbackLngNum);
    const resolvedSidoCode = rev?.sidoCode || effectiveSidoCode;
    const resolvedSggCode = rev?.sggCode || effectiveSggCode;
    const resolvedSidoName = rev?.sidoName || sidoName;
    const resolvedSggName = rev?.sggName || sggName;
    const resolvedPrefix = [resolvedSidoName, resolvedSggName]
      .filter(Boolean)
      .join(' ');
    const labelDong = params.dongName || rev?.dongName || '';

    return {
      effectiveSidoCode: resolvedSidoCode,
      effectiveSggCode: resolvedSggCode,
      resolvedLocation: {
        label: [resolvedPrefix, labelDong, params.complexName]
          .filter(Boolean)
          .join(' · '),
        sidoName: resolvedSidoName,
        sggName: resolvedSggName,
        dongName: params.dongName,
        complexName: params.complexName,
        lat: fallbackLatNum,
        lng: fallbackLngNum,
        resolutionSource: '지도·주소 지정 위치',
      },
    };
  }

  const options = await fetchRegionOptions({
    sidoCode: effectiveSidoCode,
    sggCode: effectiveSggCode,
    dealYmd: params.dealYmd,
  });

  let effectiveDong = params.dongName;

  if (params.complexName) {
    const matchedComplex =
      options.complexes.find(
        (c) =>
          c.name === params.complexName &&
          (!params.dongName || c.dongName === params.dongName) &&
          (params.propertyType === 'officetel' ||
          params.propertyType === 'officetelRent'
            ? c.type === 'officetel'
            : c.type === 'apt')
      ) ?? options.complexes.find((c) => c.name === params.complexName);

    const targetDong = matchedComplex?.dongName || effectiveDong;
    if (!effectiveDong && targetDong) {
      effectiveDong = targetDong;
    }

    // 1. Direct road address from real transaction
    if (matchedComplex?.roadAddress) {
      const pt = await geocodeKoreaAddress(
        `${regionPrefix} ${matchedComplex.roadAddress}`
      );
      if (pt) {
        return {
          effectiveSidoCode,
          effectiveSggCode,
          resolvedLocation: {
            label: `${regionPrefix} ${effectiveDong} · ${matchedComplex.name}`,
            sidoName,
            sggName,
            dongName: effectiveDong,
            complexName: matchedComplex.name,
            lat: pt.lat,
            lng: pt.lng,
            resolutionSource: '카카오 도로명 주소 좌표',
          },
        };
      }
    }

    // 2. 우정사업본부 도로명주소조회서비스 + 카카오 지오코딩
    const epostQuery = matchedComplex?.jibun
      ? `${effectiveDong} ${matchedComplex.jibun}`
      : `${sggName} ${effectiveDong} ${params.complexName}`.trim();
    const epostHits = await searchEpostAddress(epostQuery);
    if (epostHits.length > 0) {
      const cleanRoad = epostHits[0].roadAddress.replace(/\s*\(.*\)$/, '').trim();
      const ptEpost = await geocodeKoreaAddress(cleanRoad);
      if (ptEpost) {
        return {
          effectiveSidoCode,
          effectiveSggCode,
          resolvedLocation: {
            label: `${regionPrefix} ${effectiveDong} · ${params.complexName}`,
            sidoName,
            sggName,
            dongName: effectiveDong,
            complexName: params.complexName,
            lat: ptEpost.lat,
            lng: ptEpost.lng,
            resolutionSource: '우정사업본부·카카오 좌표',
          },
        };
      }
    }

    // 3. Match building or jibun inside B553077 commercial store directory
    const stores = await fetchDistrictStores(effectiveSggCode, 800);
    const cleanComplex = params.complexName.replace(/\(.*\)/g, '').trim();
    const matchedStore = stores.find((row) => {
      const bldNm = String(row.bldNm ?? '').trim();
      const lnoAdr = String(row.lnoAdr ?? '').trim();
      const ldongNm = String(row.ldongNm ?? '').trim();
      if (effectiveDong && ldongNm && ldongNm !== effectiveDong) return false;
      if (bldNm && cleanComplex && bldNm.includes(cleanComplex)) return true;
      if (matchedComplex?.jibun && lnoAdr && lnoAdr.includes(matchedComplex.jibun)) {
        return true;
      }
      return false;
    });

    if (matchedStore) {
      const lat = toNumberOrNull(matchedStore.lat);
      const lng = toNumberOrNull(matchedStore.lon);
      if (lat !== null && lng !== null) {
        return {
          effectiveSidoCode,
          effectiveSggCode,
          resolvedLocation: {
            label: `${regionPrefix} ${effectiveDong} · ${params.complexName}`,
            sidoName,
            sggName,
            dongName: effectiveDong,
            complexName: params.complexName,
            lat,
            lng,
            resolutionSource: '건물 지번 좌표 매칭',
          },
        };
      }
    }

    // 4. Complex name + dong via Kakao keyword/address
    const ptByName = await geocodeKoreaAddress(
      `${regionPrefix} ${effectiveDong} ${cleanComplex}`
    );
    if (ptByName) {
      return {
        effectiveSidoCode,
        effectiveSggCode,
        resolvedLocation: {
          label: `${regionPrefix} ${effectiveDong} · ${params.complexName}`,
          sidoName,
          sggName,
          dongName: effectiveDong,
          complexName: params.complexName,
          lat: ptByName.lat,
          lng: ptByName.lng,
          resolutionSource: '단지명 좌표',
        },
      };
    }
  }

  if (effectiveDong) {
    const ptDong = await geocodeKoreaAddress(`${regionPrefix} ${effectiveDong}`);
    if (ptDong) {
      return {
        effectiveSidoCode,
        effectiveSggCode,
        resolvedLocation: {
          label: params.complexName
            ? `${regionPrefix} ${effectiveDong} · ${params.complexName}`
            : `${regionPrefix} ${effectiveDong}`,
          sidoName,
          sggName,
          dongName: effectiveDong,
          complexName: params.complexName,
          lat: ptDong.lat,
          lng: ptDong.lng,
          resolutionSource: params.complexName ? '소속 법정동 중심' : '법정동 중심 좌표',
        },
      };
    }

    const stores = await fetchDistrictStores(effectiveSggCode, 800);
    const dongStores = stores.filter(
      (row) => String(row.ldongNm ?? '').trim() === effectiveDong
    );
    const lats = dongStores
      .map((r) => toNumberOrNull(r.lat))
      .filter((v): v is number => v !== null);
    const lngs = dongStores
      .map((r) => toNumberOrNull(r.lon))
      .filter((v): v is number => v !== null);

    if (lats.length > 0 && lngs.length > 0) {
      const avgLat = Number(
        (lats.reduce((a, b) => a + b, 0) / lats.length).toFixed(6)
      );
      const avgLng = Number(
        (lngs.reduce((a, b) => a + b, 0) / lngs.length).toFixed(6)
      );
      return {
        effectiveSidoCode,
        effectiveSggCode,
        resolvedLocation: {
          label: params.complexName
            ? `${regionPrefix} ${effectiveDong} · ${params.complexName}`
            : `${regionPrefix} ${effectiveDong}`,
          sidoName,
          sggName,
          dongName: effectiveDong,
          complexName: params.complexName,
          lat: avgLat,
          lng: avgLng,
          resolutionSource: '법정동 상가 분포 중심',
        },
      };
    }
  }

  return {
    effectiveSidoCode,
    effectiveSggCode,
    resolvedLocation: {
      label: regionPrefix || effectiveSggCode,
      sidoName,
      sggName,
      dongName: effectiveDong,
      complexName: params.complexName,
      lat: districtInfo.lat ?? fallbackLatNum,
      lng: districtInfo.lng ?? fallbackLngNum,
      resolutionSource: '시·군·구 기본 중심',
    },
  };
}

interface RebTableDef {
  id: string;
  name: string;
  key: 'landIndex' | 'landRate' | 'aptSale' | 'aptJeonse';
  fallbackPeriod: string;
}

const REB_CORE_TABLES: RebTableDef[] = [
  { id: 'A_2024_00901', name: '(월) 지역별 지가지수', key: 'landIndex', fallbackPeriod: '202509' },
  { id: 'A_2024_00903', name: '(월) 지역별 지가변동률', key: 'landRate', fallbackPeriod: '202509' },
  { id: 'A_2024_00045', name: '(월) 매매가격지수_아파트', key: 'aptSale', fallbackPeriod: '202412' },
  { id: 'A_2024_00050', name: '(월) 전세가격지수_아파트', key: 'aptJeonse', fallbackPeriod: '202412' },
];

async function fetchRebTableRows(
  apiKey: string,
  table: RebTableDef,
  dealYmd: string,
  sidoName: string,
  sggName: string
): Promise<RebStatRecord[]> {
  const shortSido = sidoName
    .replace('특별시', '')
    .replace('광역시', '')
    .replace('특별자치시', '')
    .replace('특별자치도', '')
    .replace('도', '');
  const sggToken = sggName.split(' ').pop() || sggName;

  const periodsToTry =
    dealYmd && dealYmd !== table.fallbackPeriod
      ? [dealYmd, table.fallbackPeriod]
      : [table.fallbackPeriod];

  for (const period of periodsToTry) {
    const url = new URL('https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do');
    url.searchParams.set('KEY', apiKey.trim());
    url.searchParams.set('Type', 'json');
    url.searchParams.set('STATBL_ID', table.id);
    url.searchParams.set('DTACYCLE_CD', 'MM');
    url.searchParams.set('WRTTIME_IDTFR_ID', period);
    url.searchParams.set('pIndex', '1');
    url.searchParams.set('pSize', '1000');

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) continue;
    const json = (await res.json()) as {
      SttsApiTblData?: Array<{
        head?: Array<{ RESULT?: { CODE?: string; MESSAGE?: string } }>;
        row?: Record<string, unknown>[];
      }>;
    };

    const rows = json.SttsApiTblData?.[1]?.row;
    if (!Array.isArray(rows) || rows.length === 0) {
      continue;
    }

    const mapped: RebStatRecord[] = rows.map((row, idx) => ({
      id: `${table.id}-${period}-${idx}`,
      statTableId: table.id,
      statTableName: table.name,
      regionName: String(row.CLS_NM ?? ''),
      regionFullName: String(row.CLS_FULLNM ?? row.CLS_NM ?? ''),
      itemName: String(row.ITM_NM ?? ''),
      periodCode: String(row.WRTTIME_IDTFR_ID ?? period),
      periodLabel: String(row.WRTTIME_DESC ?? period),
      value: toNumberOrNull(row.DTA_VAL),
      unit: String(row.UI_NM ?? ''),
    }));

    const matched = mapped.filter((r) => {
      const full = r.regionFullName;
      const nm = r.regionName;
      if (sggToken && (nm === sggToken || full.includes(sggToken))) return true;
      if (shortSido && (nm === shortSido || full === shortSido)) return true;
      if (nm === '전국' || nm === '수도권') return true;
      return false;
    });

    return matched.length > 0 ? matched : mapped.slice(0, 20);
  }

  return [];
}

async function fetchRebStats(params: {
  sidoCode: string;
  sggCode: string;
  dealYmd: string;
  sidoNameOverride?: string;
  sggNameOverride?: string;
}): Promise<DatasetResult<RebStatRecord, RebSummary>> {
  const apiKey = process.env.REB_API_KEY;
  const baseResult: DatasetResult<RebStatRecord, RebSummary> = {
    configured: isConfigured(apiKey),
    fetched: false,
    envVarName: 'REB_API_KEY',
    sourceName: '한국부동산원 R-ONE Open API',
    items: [],
    summary: null,
    error: null,
  };

  if (!isConfigured(apiKey)) {
    return baseResult;
  }

  try {
    const resolved = resolveRegionNames(params.sidoCode, params.sggCode);
    const sidoName = params.sidoNameOverride || resolved.sidoName;
    const sggName = params.sggNameOverride || resolved.sggName;
    const shortSido = sidoName
      .replace('특별시', '')
      .replace('광역시', '')
      .replace('특별자치시', '')
      .replace('특별자치도', '')
      .replace('도', '');
    const sggToken = sggName.split(' ').pop() || sggName;

    const results = await Promise.all(
      REB_CORE_TABLES.map((t) =>
        fetchRebTableRows(apiKey, t, params.dealYmd, sidoName, sggName)
      )
    );

    const allItems = results.flat();
    if (allItems.length === 0) {
      return {
        ...baseResult,
        fetched: true,
        items: [],
        summary: null,
      };
    }

    const pickRegionRow = (rows: RebStatRecord[]): RebStatRecord | null => {
      if (rows.length === 0) return null;
      return (
        rows.find((r) => r.regionName === sggToken) ??
        rows.find((r) => r.regionFullName.includes(sggToken)) ??
        rows.find((r) => r.regionName === shortSido) ??
        rows.find((r) => r.regionFullName.includes(shortSido)) ??
        rows.find((r) => r.regionName === '전국') ??
        rows[0]
      );
    };

    const landIdxRow = pickRegionRow(results[0]);
    const landRateRow = pickRegionRow(results[1]);
    const aptSaleRow = pickRegionRow(results[2]);
    const aptJeonseRow = pickRegionRow(results[3]);

    const summary: RebSummary = {
      landPriceIndex: landIdxRow?.value ?? null,
      landPriceIndexPeriod: landIdxRow?.periodLabel ?? null,
      landChangeRate: landRateRow?.value ?? null,
      landChangeRatePeriod: landRateRow?.periodLabel ?? null,
      aptSaleIndex: aptSaleRow?.value ?? null,
      aptSaleIndexPeriod: aptSaleRow?.periodLabel ?? null,
      aptJeonseIndex: aptJeonseRow?.value ?? null,
      aptJeonseIndexPeriod: aptJeonseRow?.periodLabel ?? null,
      matchedRegionLabel:
        landIdxRow?.regionFullName ||
        aptSaleRow?.regionFullName ||
        sggName ||
        sidoName ||
        null,
    };

    return {
      ...baseResult,
      fetched: true,
      items: allItems,
      summary,
    };
  } catch (err) {
    return {
      ...baseResult,
      fetched: true,
      error: err instanceof Error ? err.message : '한국부동산원 API 조회 실패',
    };
  }
}

async function fetchGeocode(query: string, page = 1): Promise<GeocodeResult> {
  const trimmed = query.trim();
  const safePage = Math.max(1, Math.min(3, Math.floor(page)));
  const kakaoRestKey = process.env.KAKAO_REST_API_KEY;

  if (!isConfigured(kakaoRestKey)) {
    return {
      configured: false,
      found: false,
      query: trimmed,
      address: trimmed,
      candidates: [],
      lat: null,
      lng: null,
      error: 'KAKAO_REST_API_KEY가 설정되지 않았습니다.',
    };
  }

  const headers = {
    Authorization: `KakaoAK ${kakaoRestKey.trim()}`,
  };

  try {
    const [addrRes, kwRes] = await Promise.all([
      fetch(
        `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(
          trimmed
        )}&size=15&page=${safePage}`,
        { headers, signal: AbortSignal.timeout(5000) }
      ).catch(() => null),
      fetch(
        `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(
          trimmed
        )}&size=15&page=${safePage}`,
        { headers, signal: AbortSignal.timeout(5000) }
      ).catch(() => null),
    ]);

    type KakaoAddressJson = {
      meta?: { total_count?: number; pageable_count?: number; is_end?: boolean };
      documents?: Array<{
        address_name?: string;
        x?: string;
        y?: string;
        address?: {
          address_name?: string;
          b_code?: string;
          main_address_no?: string;
          region_1depth_name?: string;
          region_2depth_name?: string;
          region_3depth_name?: string;
        } | null;
        road_address?: {
          address_name?: string;
          building_name?: string;
          main_building_no?: string;
          zone_no?: string;
          region_1depth_name?: string;
          region_2depth_name?: string;
          region_3depth_name?: string;
        } | null;
      }>;
    };

    type KakaoKeywordJson = {
      meta?: { total_count?: number; pageable_count?: number; is_end?: boolean };
      documents?: Array<{
        id?: string;
        place_name?: string;
        category_name?: string;
        address_name?: string;
        road_address_name?: string;
        x?: string;
        y?: string;
      }>;
    };

    const addrJson: KakaoAddressJson =
      addrRes && addrRes.ok ? ((await addrRes.json()) as KakaoAddressJson) : {};
    const kwJson: KakaoKeywordJson =
      kwRes && kwRes.ok ? ((await kwRes.json()) as KakaoKeywordJson) : {};

    const addrDocs = addrJson.documents ?? [];
    const kwDocs = kwJson.documents ?? [];

    const addrCandidates: SearchPlaceCandidate[] = [];
    for (let i = 0; i < addrDocs.length; i++) {
      const doc = addrDocs[i];
      const lat = toNumberOrNull(doc.y);
      const lng = toNumberOrNull(doc.x);
      if (lat === null || lng === null) continue;
      const bCode = String(doc.address?.b_code ?? '').trim();
      const sggCode = bCode.length >= 5 ? bCode.slice(0, 5) : undefined;
      const sidoCode = sggCode ? sggCode.slice(0, 2) : undefined;
      const rawSido =
        doc.address?.region_1depth_name ||
        doc.road_address?.region_1depth_name ||
        '';
      const sidoName =
        (sidoCode ? SIDO_NAMES_BY_CODE[sidoCode] : '') || rawSido || undefined;
      const sggName =
        doc.address?.region_2depth_name ||
        doc.road_address?.region_2depth_name ||
        undefined;
      const dongName =
        doc.address?.region_3depth_name ||
        doc.road_address?.region_3depth_name ||
        undefined;
      const roadAddr = String(doc.road_address?.address_name ?? '').trim();
      const lotAddr = String(doc.address?.address_name ?? '').trim();
      const bldName = String(doc.road_address?.building_name ?? '').trim();

      addrCandidates.push({
        id: `addr-${safePage}-${i}-${bCode}`,
        placeName: bldName || roadAddr || lotAddr || String(doc.address_name ?? trimmed),
        categoryName: '도로명·지번 주소',
        roadAddress: roadAddr || String(doc.address_name ?? ''),
        lotAddress: lotAddr,
        zipNo: String(doc.road_address?.zone_no ?? '').trim(),
        sidoCode,
        sggCode,
        sidoName,
        sggName,
        dongName,
        lat,
        lng,
        source: 'address',
      });
    }

    // Exact 1-hit building/parcel address search (e.g. "서울 강남구 학동로 426"): jump directly
    if (
      safePage === 1 &&
      addrCandidates.length === 1 &&
      (addrJson.meta?.total_count ?? 0) === 1 &&
      (addrDocs[0]?.road_address?.main_building_no ||
        addrDocs[0]?.address?.main_address_no)
    ) {
      const exact = addrCandidates[0];
      const rev =
        exact.sidoCode && exact.sggCode
          ? {
              sidoCode: exact.sidoCode,
              sggCode: exact.sggCode,
              sidoName: exact.sidoName || '',
              sggName: exact.sggName || '',
              dongName: exact.dongName || '',
            }
          : await reverseLookupRegionByCoords(exact.lat, exact.lng);

      return {
        configured: true,
        found: true,
        query: trimmed,
        address: exact.roadAddress || exact.lotAddress || exact.placeName,
        roadAddress: exact.roadAddress,
        lotAddress: exact.lotAddress,
        zipNo: exact.zipNo,
        sidoCode: rev?.sidoCode,
        sggCode: rev?.sggCode,
        sidoName: rev?.sidoName,
        sggName: rev?.sggName,
        dongName: rev?.dongName,
        candidates: [exact],
        totalCount: 1,
        pageableCount: 1,
        page: 1,
        isEnd: true,
        lat: exact.lat,
        lng: exact.lng,
        error: null,
      };
    }

    const kwCandidates: SearchPlaceCandidate[] = [];
    for (let i = 0; i < kwDocs.length; i++) {
      const doc = kwDocs[i];
      const lat = toNumberOrNull(doc.y);
      const lng = toNumberOrNull(doc.x);
      if (lat === null || lng === null) continue;
      kwCandidates.push({
        id: `kw-${doc.id ?? `${safePage}-${i}`}`,
        placeName: String(doc.place_name ?? '').trim() || trimmed,
        categoryName: String(doc.category_name ?? '').trim() || '장소·건물',
        roadAddress: String(doc.road_address_name ?? '').trim(),
        lotAddress: String(doc.address_name ?? '').trim(),
        zipNo: '',
        lat,
        lng,
        source: 'keyword',
      });
    }

    // Prioritize residential facilities (아파트·오피스텔·주택) when mixing with ancillary POIs like 편의점/주차장
    const scoreKw = (c: SearchPlaceCandidate): number => {
      if (c.categoryName.includes('부동산 > 주거시설')) return 0;
      if (c.categoryName.includes('교통,수송 > 지하철')) return 1;
      if (c.categoryName.includes('주차장') || c.categoryName.includes('편의점')) {
        return 3;
      }
      return 2;
    };
    kwCandidates.sort((a, b) => scoreKw(a) - scoreKw(b));

    const merged: SearchPlaceCandidate[] = [...addrCandidates];
    for (const kw of kwCandidates) {
      const duplicate = merged.some((m) => {
        if (m.placeName !== kw.placeName) return false;
        const gap = haversineMeters(m.lat, m.lng, kw.lat, kw.lng);
        return gap !== null && gap < 30;
      });
      if (!duplicate) {
        merged.push(kw);
      }
    }

    if (merged.length === 0) {
      return {
        configured: true,
        found: false,
        query: trimmed,
        address: trimmed,
        candidates: [],
        totalCount: 0,
        pageableCount: 0,
        page: safePage,
        isEnd: true,
        lat: null,
        lng: null,
        error: '카카오 API에서 일치하는 주소 또는 단지·건물을 찾지 못했습니다.',
      };
    }

    const top = merged[0];
    let rev: {
      sidoCode: string;
      sggCode: string;
      sidoName: string;
      sggName: string;
      dongName: string;
    } | null = null;

    if (merged.length === 1) {
      rev =
        top.sidoCode && top.sggCode
          ? {
              sidoCode: top.sidoCode,
              sggCode: top.sggCode,
              sidoName: top.sidoName || '',
              sggName: top.sggName || '',
              dongName: top.dongName || '',
            }
          : await reverseLookupRegionByCoords(top.lat, top.lng);
    }

    const addrTotal = addrJson.meta?.total_count ?? addrCandidates.length;
    const kwTotal = kwJson.meta?.total_count ?? kwCandidates.length;
    const totalCount = Math.max(addrTotal, kwTotal, merged.length);
    const pageableCount = Math.min(
      45,
      Math.max(
        addrJson.meta?.pageable_count ?? addrCandidates.length,
        kwJson.meta?.pageable_count ?? kwCandidates.length,
        merged.length
      )
    );
    const isEnd =
      (addrJson.meta?.is_end ?? true) && (kwJson.meta?.is_end ?? true);

    return {
      configured: true,
      found: true,
      query: trimmed,
      address: top.roadAddress || top.lotAddress || top.placeName,
      roadAddress: top.roadAddress,
      lotAddress: top.lotAddress,
      zipNo: top.zipNo,
      sidoCode: rev?.sidoCode ?? top.sidoCode,
      sggCode: rev?.sggCode ?? top.sggCode,
      sidoName: rev?.sidoName ?? top.sidoName,
      sggName: rev?.sggName ?? top.sggName,
      dongName: rev?.dongName ?? top.dongName,
      candidates: merged,
      totalCount,
      pageableCount,
      page: safePage,
      isEnd,
      lat: top.lat,
      lng: top.lng,
      error: null,
    };
  } catch (err) {
    return {
      configured: true,
      found: false,
      query: trimmed,
      address: trimmed,
      candidates: [],
      lat: null,
      lng: null,
      error:
        err instanceof Error
          ? err.message
          : '카카오 주소·장소 검색 중 오류가 발생했습니다.',
    };
  }
}

function formatYyyymmddDate(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length !== 8) return '';
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function roundToTwo(val: number): number {
  return Math.round(val * 100) / 100;
}

function parseBuildingHubItems(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as {
    response?: {
      header?: { resultCode?: string };
      body?: { items?: { item?: unknown } | string };
    };
  };
  if (root.response?.header?.resultCode && root.response.header.resultCode !== '00') {
    return [];
  }
  const itemsNode = root.response?.body?.items;
  if (!itemsNode || typeof itemsNode === 'string') return [];
  const rawItem = itemsNode.item;
  if (!rawItem) return [];
  if (Array.isArray(rawItem)) {
    return rawItem.filter(
      (x): x is Record<string, unknown> => Boolean(x && typeof x === 'object')
    );
  }
  if (typeof rawItem === 'object') {
    return [rawItem as Record<string, unknown>];
  }
  return [];
}

async function fetchBuildingHubEndpoint(
  service: 'BldRgstHubService' | 'ShtRgstHubService',
  operation: string,
  queryParams: Record<string, string>
): Promise<{ ok: boolean; error?: string; items: Record<string, unknown>[] }> {
  const apiKey = process.env.PUBLIC_DATA_API_KEY;
  if (!isConfigured(apiKey)) {
    return { ok: false, error: 'PUBLIC_DATA_API_KEY 미설정', items: [] };
  }
  try {
    const encodedKey = encodeServiceKey(apiKey.trim());
    const qs = new URLSearchParams({
      ...queryParams,
      _type: 'json',
    });
    const url = `https://apis.data.go.kr/1613000/${service}/${operation}?serviceKey=${encodedKey}&${qs.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, items: [] };
    }
    const text = await res.text();
    if (!text.trim().startsWith('{')) {
      return { ok: false, error: '비정상 응답 형식', items: [] };
    }
    const json = JSON.parse(text) as {
      response?: { header?: { resultCode?: string; resultMsg?: string } };
    };
    const code = json.response?.header?.resultCode;
    if (code && code !== '00') {
      return {
        ok: false,
        error: json.response?.header?.resultMsg || `코드 ${code}`,
        items: [],
      };
    }
    return { ok: true, items: parseBuildingHubItems(json) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '요청 실패',
      items: [],
    };
  }
}

interface ResolvedParcelCode {
  sigunguCd: string;
  bjdongCd: string;
  platGbCd: string;
  bun: string;
  ji: string;
  roadAddressHint: string;
}

async function resolveParcelFromAddressQuery(
  query: string
): Promise<ResolvedParcelCode | null> {
  const kakaoRestKey = process.env.KAKAO_REST_API_KEY;
  if (!isConfigured(kakaoRestKey) || !query.trim()) return null;
  try {
    const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(
      query.trim()
    )}&size=1`;
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${kakaoRestKey.trim()}` },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      documents?: Array<{
        address?: {
          b_code?: string;
          mountain_yn?: string;
          main_address_no?: string;
          sub_address_no?: string;
        } | null;
        road_address?: {
          address_name?: string;
        } | null;
      }>;
    };
    const doc = json.documents?.[0];
    const addr = doc?.address;
    const bCode = String(addr?.b_code ?? '').trim();
    const mainNo = String(addr?.main_address_no ?? '').replace(/\D/g, '');
    if (bCode.length < 10 || !mainNo) return null;
    const subNo = String(addr?.sub_address_no ?? '').replace(/\D/g, '');
    return {
      sigunguCd: bCode.slice(0, 5),
      bjdongCd: bCode.slice(5, 10),
      platGbCd: addr?.mountain_yn === 'Y' ? '1' : '0',
      bun: mainNo.padStart(4, '0'),
      ji: (subNo || '0').padStart(4, '0'),
      roadAddressHint: String(doc?.road_address?.address_name ?? '').trim(),
    };
  } catch {
    return null;
  }
}

async function resolveParcelFromCoords(
  lat: number,
  lng: number
): Promise<ResolvedParcelCode | null> {
  const kakaoRestKey = process.env.KAKAO_REST_API_KEY;
  if (!isConfigured(kakaoRestKey)) return null;

  const headers = { Authorization: `KakaoAK ${kakaoRestKey.trim()}` };
  try {
    const [c2aRes, c2rRes] = await Promise.all([
      fetch(
        `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${encodeURIComponent(
          String(lng)
        )}&y=${encodeURIComponent(String(lat))}`,
        { headers, signal: AbortSignal.timeout(4500) }
      ),
      fetch(
        `https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${encodeURIComponent(
          String(lng)
        )}&y=${encodeURIComponent(String(lat))}`,
        { headers, signal: AbortSignal.timeout(4500) }
      ),
    ]);

    let sigunguCd = '';
    let bjdongCd = '';
    if (c2rRes.ok) {
      const rJson = (await c2rRes.json()) as {
        documents?: Array<{ region_type?: string; code?: string }>;
      };
      const legal = rJson.documents?.find((d) => d.region_type === 'B');
      const code = String(legal?.code ?? '').trim();
      if (code.length >= 10) {
        sigunguCd = code.slice(0, 5);
        bjdongCd = code.slice(5, 10);
      }
    }

    if (c2aRes.ok) {
      const aJson = (await c2aRes.json()) as {
        documents?: Array<{
          address?: {
            mountain_yn?: string;
            main_address_no?: string;
            sub_address_no?: string;
          } | null;
          road_address?: {
            address_name?: string;
          } | null;
        }>;
      };
      const doc = aJson.documents?.[0];
      const roadHint = String(doc?.road_address?.address_name ?? '').trim();
      const addr = doc?.address;
      const mainNo = String(addr?.main_address_no ?? '').replace(/\D/g, '');
      const subNo = String(addr?.sub_address_no ?? '').replace(/\D/g, '');

      if (sigunguCd && bjdongCd && mainNo) {
        return {
          sigunguCd,
          bjdongCd,
          platGbCd: addr?.mountain_yn === 'Y' ? '1' : '0',
          bun: mainNo.padStart(4, '0'),
          ji: (subNo || '0').padStart(4, '0'),
          roadAddressHint: roadHint,
        };
      }
      if (roadHint) {
        const viaRoad = await resolveParcelFromAddressQuery(roadHint);
        if (viaRoad) return viaRoad;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function mapClosedBuildingRecord(
  row: Record<string, unknown>,
  idx: number
): ClosedBuildingRecord {
  const bldNm = String(row.bldNm ?? '').trim();
  const dongNm = String(row.dongNm ?? '').trim();
  const buildingName =
    bldNm && dongNm && bldNm !== dongNm
      ? `${bldNm} (${dongNm})`
      : bldNm || dongNm || String(row.regstrKindCdNm ?? '').trim() || '건축물';
  const grnd = toNumberOrNull(row.grndFlrCnt);
  const ugrnd = toNumberOrNull(row.ugrndFlrCnt);
  const floorParts: string[] = [];
  if (grnd !== null && grnd > 0) floorParts.push(`지상 ${grnd}층`);
  if (ugrnd !== null && ugrnd > 0) floorParts.push(`지하 ${ugrnd}층`);

  const purpsMain = String(row.mainPurpsCdNm ?? '').trim();
  const purpsEtc = String(row.etcPurps ?? '').trim();
  const mainPurpose =
    purpsMain && purpsEtc && purpsEtc !== purpsMain
      ? `${purpsMain} (${purpsEtc})`
      : purpsMain || purpsEtc;

  const totArea = toNumberOrNull(row.totArea);

  return {
    id: `sht-${String(row.mgmShtregPk ?? idx)}-${idx}`,
    buildingName,
    lotAddress: String(row.platPlc ?? '').trim(),
    regstrKindName: String(row.regstrKindCdNm ?? '').trim(),
    closureTypeName: String(row.shterGbCdNm ?? '').trim() || '말소',
    closureDate: formatYyyymmddDate(row.shterDay),
    mainPurpose,
    structure: String(row.strctCdNm ?? row.etcStrct ?? '').trim(),
    totAreaSqm: totArea !== null && totArea > 0 ? roundToTwo(totArea) : null,
    floorsLabel: floorParts.join(' / '),
    useApprovalDate: formatYyyymmddDate(row.useAprDay),
  };
}

async function fetchBuildingRegister(params: {
  centerLat: number | null;
  centerLng: number | null;
  complexName?: string;
}): Promise<BuildingRegisterResult> {
  const hasPublicData = isConfigured(process.env.PUBLIC_DATA_API_KEY);
  const emptyResult: BuildingRegisterResult = {
    configured: hasPublicData,
    error: null,
    sigunguCd: '',
    bjdongCd: '',
    bun: '',
    ji: '',
    closedScope: 'none',
    summary: null,
    closedRecords: [],
  };

  if (!hasPublicData || params.centerLat === null || params.centerLng === null) {
    return emptyResult;
  }

  let parcel = await resolveParcelFromCoords(
    params.centerLat,
    params.centerLng
  );
  if (!parcel) {
    return emptyResult;
  }

  const cacheKey = `${parcel.sigunguCd}-${parcel.bjdongCd}-${parcel.platGbCd}-${parcel.bun}-${parcel.ji}`;
  const cached = buildingRegisterCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const queryParcel = async (p: ResolvedParcelCode) => {
    const q = {
      sigunguCd: p.sigunguCd,
      bjdongCd: p.bjdongCd,
      platGbCd: p.platGbCd,
      bun: p.bun,
      ji: p.ji,
      numOfRows: '30',
      pageNo: '1',
    };
    const [recapRes, titleRes, jijiguRes, srRecapRes, srTitleRes] =
      await Promise.all([
        fetchBuildingHubEndpoint('BldRgstHubService', 'getBrRecapTitleInfo', q),
        fetchBuildingHubEndpoint('BldRgstHubService', 'getBrTitleInfo', q),
        fetchBuildingHubEndpoint('BldRgstHubService', 'getBrJijiguInfo', {
          ...q,
          numOfRows: '15',
        }),
        fetchBuildingHubEndpoint('ShtRgstHubService', 'getSrRecapTitleInfo', q),
        fetchBuildingHubEndpoint('ShtRgstHubService', 'getSrTitleInfo', q),
      ]);
    return { recapRes, titleRes, jijiguRes, srRecapRes, srTitleRes };
  };

  let bundle = await queryParcel(parcel);

  if (
    bundle.recapRes.items.length === 0 &&
    bundle.titleRes.items.length === 0 &&
    parcel.roadAddressHint
  ) {
    const fallbackParcel = await resolveParcelFromAddressQuery(
      parcel.roadAddressHint
    );
    if (
      fallbackParcel &&
      (fallbackParcel.bun !== parcel.bun || fallbackParcel.ji !== parcel.ji)
    ) {
      parcel = fallbackParcel;
      bundle = await queryParcel(parcel);
    }
  }

  const firstError =
    (!bundle.recapRes.ok && bundle.recapRes.error) ||
    (!bundle.titleRes.ok && bundle.titleRes.error) ||
    null;

  const recap = bundle.recapRes.items[0] ?? null;
  const titles = bundle.titleRes.items;
  const mainTitles = titles.filter(
    (t) => String(t.mainAtchGbCd ?? '').trim() === '0'
  );
  const effectiveTitles = mainTitles.length > 0 ? mainTitles : titles;

  let summary: BuildingLedgerSummary | null = null;
  if (recap || effectiveTitles.length > 0) {
    const primary =
      recap ??
      [...effectiveTitles].sort(
        (a, b) =>
          (toNumberOrNull(b.totArea) ?? 0) - (toNumberOrNull(a.totArea) ?? 0)
      )[0];

    const primaryTitle =
      [...effectiveTitles].sort(
        (a, b) =>
          (toNumberOrNull(b.grndFlrCnt) ?? 0) -
          (toNumberOrNull(a.grndFlrCnt) ?? 0)
      )[0] ?? null;

    const platAreaRaw = toNumberOrNull(primary.platArea);
    const archAreaRaw = toNumberOrNull(primary.archArea);
    const totAreaRaw = toNumberOrNull(primary.totArea);
    const bcRatRaw = toNumberOrNull(primary.bcRat);
    const vlRatRaw = toNumberOrNull(primary.vlRat);

    const hhldFromRecap = recap ? toNumberOrNull(recap.hhldCnt) : null;
    const hhldFromTitles = effectiveTitles.reduce(
      (acc, t) => acc + (toNumberOrNull(t.hhldCnt) ?? 0),
      0
    );
    const householdCount =
      hhldFromRecap !== null && hhldFromRecap > 0
        ? hhldFromRecap
        : hhldFromTitles > 0
          ? hhldFromTitles
          : null;

    const hoFromRecap = recap ? toNumberOrNull(recap.hoCnt) : null;
    const hoFromTitles = effectiveTitles.reduce(
      (acc, t) => acc + (toNumberOrNull(t.hoCnt) ?? 0),
      0
    );
    const hoCount =
      hoFromRecap !== null && hoFromRecap > 0
        ? hoFromRecap
        : hoFromTitles > 0
          ? hoFromTitles
          : null;

    const mainBldCntRecap = recap ? toNumberOrNull(recap.mainBldCnt) : null;
    const mainBuildingCount =
      mainBldCntRecap !== null && mainBldCntRecap > 0
        ? mainBldCntRecap
        : mainTitles.length > 0
          ? mainTitles.length
          : null;

    const groundFloorsList = effectiveTitles
      .map((t) => toNumberOrNull(t.grndFlrCnt))
      .filter((v): v is number => v !== null && v > 0);
    const ugrndFloorsList = titles
      .map((t) => toNumberOrNull(t.ugrndFlrCnt))
      .filter((v): v is number => v !== null && v > 0);

    const sumParking = (row: Record<string, unknown>): number => {
      const explicitTot = toNumberOrNull(row.totPkngCnt);
      if (explicitTot !== null && explicitTot > 0) return explicitTot;
      return (
        (toNumberOrNull(row.indrAutoUtcnt) ?? 0) +
        (toNumberOrNull(row.oudrAutoUtcnt) ?? 0) +
        (toNumberOrNull(row.indrMechUtcnt) ?? 0) +
        (toNumberOrNull(row.oudrMechUtcnt) ?? 0)
      );
    };

    const recapParking = recap ? sumParking(recap) : 0;
    const titlesParking = titles.reduce((acc, t) => acc + sumParking(t), 0);
    const totalParkingCount =
      recapParking > 0
        ? recapParking
        : titlesParking > 0
          ? titlesParking
          : null;

    const parkingDenominator = householdCount ?? hoCount;
    const parkingPerHousehold =
      totalParkingCount !== null &&
      parkingDenominator !== null &&
      parkingDenominator > 0
        ? roundToTwo(totalParkingCount / parkingDenominator)
        : null;

    const elevatorTotal = titles.reduce(
      (acc, t) =>
        acc +
        (toNumberOrNull(t.rideUseElvtCnt) ?? 0) +
        (toNumberOrNull(t.emgenUseElvtCnt) ?? 0),
      0
    );

    const rawApproval =
      String(primary.useAprDay ?? '').trim() ||
      String(primaryTitle?.useAprDay ?? '').trim();
    const useApprovalDate = formatYyyymmddDate(rawApproval);
    const approvalYear = Number(useApprovalDate.slice(0, 4));
    const buildingAgeYears =
      useApprovalDate && Number.isFinite(approvalYear) && approvalYear > 1900
        ? Math.max(0, new Date().getFullYear() - approvalYear)
        : null;

    const purpsMain = String(primary.mainPurpsCdNm ?? '').trim();
    const purpsEtc = String(primary.etcPurps ?? '').trim();
    const mainPurpose =
      purpsMain && purpsEtc && purpsEtc !== purpsMain
        ? `${purpsMain} (${purpsEtc})`
        : purpsMain || purpsEtc;

    const zoningItems: string[] = [];
    for (const z of bundle.jijiguRes.items) {
      const name = String(z.etcJijigu ?? z.jijiguCdNm ?? '').trim();
      if (name && !zoningItems.includes(name)) {
        zoningItems.push(name);
      }
    }

    const seismicValues = effectiveTitles
      .map((t) => String(t.rserthqkDsgnApplyYn ?? '').trim())
      .filter(Boolean);
    const seismicDesignApplied =
      seismicValues.length === 0
        ? null
        : seismicValues.some((v) => v === '1' || v === 'Y');

    const greenGrade =
      effectiveTitles
        .map((t) => String(t.gnBldGrade ?? '').trim())
        .find((g) => Boolean(g)) ?? '';

    const violationValues = [recap, ...titles]
      .filter((x): x is Record<string, unknown> => Boolean(x))
      .map((x) => String(x.vltnBldYn ?? '').trim())
      .filter(Boolean);
    const violationFlag =
      violationValues.length === 0
        ? null
        : violationValues.some((v) => v === '1' || v === 'Y');

    const roadAddress =
      String(primary.newPlatPlc ?? '').trim() ||
      titles
        .map((t) => String(t.newPlatPlc ?? '').trim())
        .find((a) => Boolean(a)) ||
      parcel.roadAddressHint;

    const buildingName =
      String(primary.bldNm ?? '').trim() ||
      titles.map((t) => String(t.bldNm ?? '').trim()).find((n) => Boolean(n)) ||
      String(params.complexName ?? '').trim();

    summary = {
      pnuLabel: String(primary.platPlc ?? '').trim(),
      roadAddress,
      buildingName,
      regstrKindName: String(primary.regstrKindCdNm ?? '').trim(),
      mainPurpose,
      structure: String(
        primaryTitle?.strctCdNm ?? primary.strctCdNm ?? primaryTitle?.etcStrct ?? ''
      ).trim(),
      zoning: zoningItems.slice(0, 3).join(' · '),
      platAreaSqm:
        platAreaRaw !== null && platAreaRaw > 0 ? roundToTwo(platAreaRaw) : null,
      archAreaSqm:
        archAreaRaw !== null && archAreaRaw > 0 ? roundToTwo(archAreaRaw) : null,
      totAreaSqm:
        totAreaRaw !== null && totAreaRaw > 0 ? roundToTwo(totAreaRaw) : null,
      bcRatPct:
        bcRatRaw !== null && bcRatRaw > 0 ? roundToTwo(bcRatRaw) : null,
      vlRatPct:
        vlRatRaw !== null && vlRatRaw > 0 ? roundToTwo(vlRatRaw) : null,
      householdCount,
      hoCount,
      mainBuildingCount,
      maxGroundFloors:
        groundFloorsList.length > 0 ? Math.max(...groundFloorsList) : null,
      maxUndergroundFloors:
        ugrndFloorsList.length > 0 ? Math.max(...ugrndFloorsList) : null,
      totalParkingCount,
      parkingPerHousehold,
      elevatorCount: elevatorTotal > 0 ? elevatorTotal : null,
      useApprovalDate,
      buildingAgeYears,
      seismicDesignApplied,
      greenBuildingGrade: greenGrade,
      violationFlag,
    };
  }

  let closedRaw = [...bundle.srRecapRes.items, ...bundle.srTitleRes.items];
  let closedScope: 'parcel' | 'dong' | 'none' =
    closedRaw.length > 0 ? 'parcel' : 'none';

  if (closedRaw.length === 0) {
    const dongSrRes = await fetchBuildingHubEndpoint(
      'ShtRgstHubService',
      'getSrTitleInfo',
      {
        sigunguCd: parcel.sigunguCd,
        bjdongCd: parcel.bjdongCd,
        numOfRows: '15',
        pageNo: '1',
      }
    );
    if (dongSrRes.items.length > 0) {
      closedRaw = dongSrRes.items;
      closedScope = 'dong';
    }
  }

  const closedRecords = closedRaw
    .map(mapClosedBuildingRecord)
    .sort((a, b) => b.closureDate.localeCompare(a.closureDate))
    .slice(0, 12);

  const result: BuildingRegisterResult = {
    configured: hasPublicData,
    error: summary || closedRecords.length > 0 ? null : firstError,
    sigunguCd: parcel.sigunguCd,
    bjdongCd: parcel.bjdongCd,
    bun: parcel.bun,
    ji: parcel.ji,
    closedScope,
    summary,
    closedRecords,
  };

  buildingRegisterCache.set(cacheKey, {
    expiresAt: Date.now() + 1000 * 60 * 30,
    data: result,
  });

  return result;
}

async function fetchSeoulCityData(params: {
  centerLat: number | null;
  centerLng: number | null;
  areaCodeOverride?: string;
}): Promise<SeoulCityDataSummary> {
  const apiKey = process.env.SEOUL_OPEN_DATA_API_KEY;
  const configured = isConfigured(apiKey);

  const emptyBase: SeoulCityDataSummary = {
    configured,
    supported: false,
    areaCode: '',
    areaName: '',
    areaCategory: '',
    areaPolygon: [],
    distanceMeters: null,
    nearbyHotspots: [],
    error: null,
    congestLevel: '',
    congestMessage: '',
    populationMin: null,
    populationMax: null,
    maleRate: null,
    femaleRate: null,
    residentRate: null,
    nonResidentRate: null,
    ageRates: [],
    populationTime: '',
    forecast: [],
    commercialLevel: '',
    commercialTime: '',
    shPaymentCount: null,
    shPaymentMinWon: null,
    shPaymentMaxWon: null,
    commercialMaleRate: null,
    commercialFemaleRate: null,
    commercialAgeRates: [],
    commercialPersonalRate: null,
    commercialCorporationRate: null,
    commercialCategories: [],
    transit: null,
    roadTrafficLevel: '',
    roadTrafficSpeedKmh: null,
    roadTrafficMessage: '',
    temperatureC: null,
    pm10: null,
    pm10Index: '',
    pm25: null,
    pm25Index: '',
    airIndex: '',
    parkingTotalCount: 0,
    parkingLots: [],
  };

  if (!configured || params.centerLat === null || params.centerLng === null) {
    return emptyBase;
  }

  const withDistances = SEOUL_CITYDATA_HOTSPOTS.map((h) => ({
    ...h,
    distanceMeters:
      haversineMeters(params.centerLat, params.centerLng, h.lat, h.lng) ??
      Number.MAX_SAFE_INTEGER,
  })).sort((a, b) => a.distanceMeters - b.distanceMeters);

  const nearbyHotspots = withDistances
    .filter((h) => h.distanceMeters <= 3500)
    .slice(0, 4)
    .map((h) => ({
      code: h.code,
      name: h.name,
      distanceMeters: h.distanceMeters,
    }));

  if (nearbyHotspots.length === 0) {
    return emptyBase;
  }

  const targetHotspot =
    (params.areaCodeOverride
      ? withDistances.find((h) => h.code === params.areaCodeOverride)
      : null) ?? withDistances[0];

  const cached = seoulCityDataCache.get(targetHotspot.code);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.data,
      configured: true,
      supported: true,
      distanceMeters: targetHotspot.distanceMeters,
      nearbyHotspots,
    };
  }

  try {
    const url = `http://openapi.seoul.go.kr:8088/${encodeURIComponent(
      apiKey.trim()
    )}/json/citydata/1/5/${encodeURIComponent(targetHotspot.code)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      return {
        ...emptyBase,
        supported: true,
        areaCode: targetHotspot.code,
        areaName: targetHotspot.name,
        distanceMeters: targetHotspot.distanceMeters,
        nearbyHotspots,
        error: `서울시 도시데이터 HTTP ${res.status}`,
      };
    }

    const areaPolygonEntry = SEOUL_HOTSPOT_AREAS[targetHotspot.code];
    const resolvedAreaCategory = areaPolygonEntry?.category ?? '';
    const resolvedAreaPolygon = areaPolygonEntry?.rings ?? [];

    const json = (await res.json()) as {
      RESULT?: { 'RESULT.CODE'?: string; 'RESULT.MESSAGE'?: string };
      CITYDATA?: {
        AREA_NM?: string;
        AREA_CD?: string;
        LIVE_PPLTN_STTS?: Array<Record<string, unknown>>;
        LIVE_CMRCL_STTS?: {
          AREA_CMRCL_LVL?: string;
          AREA_SH_PAYMENT_CNT?: string | number;
          AREA_SH_PAYMENT_AMT_MIN?: string | number;
          AREA_SH_PAYMENT_AMT_MAX?: string | number;
          CMRCL_MALE_RATE?: string | number;
          CMRCL_FEMALE_RATE?: string | number;
          CMRCL_10_RATE?: string | number;
          CMRCL_20_RATE?: string | number;
          CMRCL_30_RATE?: string | number;
          CMRCL_40_RATE?: string | number;
          CMRCL_50_RATE?: string | number;
          CMRCL_60_RATE?: string | number;
          CMRCL_PERSONAL_RATE?: string | number;
          CMRCL_CORPORATION_RATE?: string | number;
          CMRCL_TIME?: string;
          CMRCL_RSB?: Array<Record<string, unknown>>;
        };
        ROAD_TRAFFIC_STTS?: {
          AVG_ROAD_DATA?: {
            ROAD_MSG?: string;
            ROAD_TRAFFIC_IDX?: string;
            ROAD_TRAFFIC_SPD?: string | number;
          };
        };
        WEATHER_STTS?: Array<Record<string, unknown>>;
        PRK_STTS?: Array<Record<string, unknown>>;
        SUB_STTS?: Array<Record<string, unknown>>;
        LIVE_SUB_PPLTN?:
          | Record<string, unknown>
          | Array<Record<string, unknown>>;
        LIVE_BUS_PPLTN?:
          | Record<string, unknown>
          | Array<Record<string, unknown>>;
      };
    };

    const cd = json.CITYDATA;
    if (!cd) {
      return {
        ...emptyBase,
        supported: true,
        areaCode: targetHotspot.code,
        areaName: targetHotspot.name,
        areaCategory: resolvedAreaCategory,
        areaPolygon: resolvedAreaPolygon,
        distanceMeters: targetHotspot.distanceMeters,
        nearbyHotspots,
        error:
          json.RESULT?.['RESULT.MESSAGE'] ||
          '서울시 실시간 도시데이터 응답이 비어 있습니다.',
      };
    }

    const ppltn = cd.LIVE_PPLTN_STTS?.[0] ?? {};
    const ageDefs: Array<[string, string]> = [
      ['10대', 'PPLTN_RATE_10'],
      ['20대', 'PPLTN_RATE_20'],
      ['30대', 'PPLTN_RATE_30'],
      ['40대', 'PPLTN_RATE_40'],
      ['50대', 'PPLTN_RATE_50'],
      ['60대', 'PPLTN_RATE_60'],
      ['70대+', 'PPLTN_RATE_70'],
    ];
    const ageRates = ageDefs
      .map(([label, key]) => {
        const val = toNumberOrNull(ppltn[key]);
        return val !== null ? { label, rate: roundToTwo(val) } : null;
      })
      .filter((x): x is { label: string; rate: number } => Boolean(x));

    const rawForecast = Array.isArray(ppltn.FCST_PPLTN)
      ? (ppltn.FCST_PPLTN as Array<Record<string, unknown>>)
      : [];
    const forecast: SeoulCityDataForecastItem[] = rawForecast
      .map((f) => {
        const rawTime = String(f.FCST_TIME ?? '').trim();
        const timePart = rawTime.split(' ')[1] || rawTime;
        return {
          timeLabel: timePart.slice(0, 5),
          congestLevel: String(f.FCST_CONGEST_LVL ?? '').trim(),
          minPopulation: toNumberOrNull(f.FCST_PPLTN_MIN),
          maxPopulation: toNumberOrNull(f.FCST_PPLTN_MAX),
        };
      })
      .filter((f) => f.timeLabel || f.congestLevel);

    const cmrcl = (cd.LIVE_CMRCL_STTS ?? {}) as Record<string, unknown>;
    const cmrclAgeDefs: Array<[string, string]> = [
      ['10대', 'CMRCL_10_RATE'],
      ['20대', 'CMRCL_20_RATE'],
      ['30대', 'CMRCL_30_RATE'],
      ['40대', 'CMRCL_40_RATE'],
      ['50대', 'CMRCL_50_RATE'],
      ['60대+', 'CMRCL_60_RATE'],
    ];
    const commercialAgeRates = cmrclAgeDefs
      .map(([label, key]) => {
        const val = toNumberOrNull(cmrcl[key]);
        return val !== null ? { label, rate: roundToTwo(val) } : null;
      })
      .filter((x): x is { label: string; rate: number } => Boolean(x));

    const rawCmrclTime = String(cmrcl.CMRCL_TIME ?? '').trim();
    const commercialTime =
      rawCmrclTime.length === 13 && rawCmrclTime.includes(' ')
        ? `${rawCmrclTime.slice(0, 4)}-${rawCmrclTime.slice(4, 6)}-${rawCmrclTime.slice(6, 8)} ${rawCmrclTime.slice(9, 11)}:${rawCmrclTime.slice(11, 13)}`
        : rawCmrclTime;

    const rawRsb = Array.isArray(cmrcl.CMRCL_RSB)
      ? (cmrcl.CMRCL_RSB as Array<Record<string, unknown>>)
      : [];
    const parsedCats = rawRsb
      .map((r) => {
        const paymentCount = toNumberOrNull(r.RSB_SH_PAYMENT_CNT);
        const paymentAmountMinWon = toNumberOrNull(r.RSB_SH_PAYMENT_AMT_MIN);
        const paymentAmountMaxWon = toNumberOrNull(r.RSB_SH_PAYMENT_AMT_MAX);
        const paymentAmountMidWon =
          paymentAmountMinWon !== null && paymentAmountMaxWon !== null
            ? Math.round((paymentAmountMinWon + paymentAmountMaxWon) / 2)
            : (paymentAmountMaxWon ?? paymentAmountMinWon);
        const avgSpendWon =
          paymentAmountMidWon !== null &&
          paymentCount !== null &&
          paymentCount > 0
            ? Math.round(paymentAmountMidWon / paymentCount)
            : null;
        const merchantCount = toNumberOrNull(r.RSB_MCT_CNT);
        const spendPerMerchantWon =
          paymentAmountMidWon !== null &&
          merchantCount !== null &&
          merchantCount > 0
            ? Math.round(paymentAmountMidWon / merchantCount)
            : null;
        return {
          largeCategory: String(r.RSB_LRG_CTGR ?? '').trim(),
          mediumCategory: String(r.RSB_MID_CTGR ?? '').trim(),
          paymentLevel: String(r.RSB_PAYMENT_LVL ?? '').trim(),
          paymentCount,
          paymentAmountMinWon,
          paymentAmountMaxWon,
          paymentAmountMidWon,
          avgSpendWon,
          merchantCount,
          spendPerMerchantWon,
          consumptionScore: null as number | null,
        };
      })
      .filter((c) => c.mediumCategory || c.largeCategory)
      .sort((a, b) => {
        const amtDiff =
          (b.paymentAmountMidWon ?? -1) - (a.paymentAmountMidWon ?? -1);
        if (amtDiff !== 0) return amtDiff;
        return (b.paymentCount ?? -1) - (a.paymentCount ?? -1);
      });

    const maxCatAmt = Math.max(
      ...parsedCats.map((c) => c.paymentAmountMidWon ?? 0),
      0
    );
    const maxSpendPerMerchant = Math.max(
      ...parsedCats.map((c) => c.spendPerMerchantWon ?? 0),
      0
    );

    const commercialCategories: SeoulCityDataCategoryStat[] = parsedCats.map(
      (c) => {
        const amt = c.paymentAmountMidWon ?? 0;
        const perMerchant = c.spendPerMerchantWon ?? 0;
        if (maxCatAmt <= 0 || amt <= 0) {
          return { ...c, consumptionScore: null };
        }
        const totalRatio = Math.sqrt(amt / maxCatAmt);
        const effRatio =
          maxSpendPerMerchant > 0 && perMerchant > 0
            ? Math.sqrt(perMerchant / maxSpendPerMerchant)
            : totalRatio;
        const score = Math.round((0.5 * totalRatio + 0.5 * effRatio) * 100);
        return { ...c, consumptionScore: score };
      }
    );

    const avgRoad = cd.ROAD_TRAFFIC_STTS?.AVG_ROAD_DATA ?? {};
    const weather = cd.WEATHER_STTS?.[0] ?? {};
    const rawPrk = Array.isArray(cd.PRK_STTS) ? cd.PRK_STTS : [];

    const parkingLots: SeoulParkingStatusItem[] = rawPrk
      .map((p) => {
        const capacity = toNumberOrNull(p.CPCTY);
        const curCnt = toNumberOrNull(p.CUR_PRK_CNT);
        const realtimeProvided =
          String(p.CUR_PRK_YN ?? '').trim() === 'Y' && curCnt !== null;
        const availableCount =
          realtimeProvided && capacity !== null && curCnt !== null
            ? Math.max(0, capacity - curCnt)
            : null;
        return {
          name: String(p.PRK_NM ?? '').trim(),
          address:
            String(p.ROAD_ADDR ?? '').trim() || String(p.ADDRESS ?? '').trim(),
          capacity,
          currentCount: realtimeProvided ? curCnt : null,
          availableCount,
          payYn: String(p.PAY_YN ?? '').trim(),
          baseRateWon: toNumberOrNull(p.RATES),
          baseTimeMin: toNumberOrNull(p.TIME_RATES),
          realtimeProvided,
        };
      })
      .filter((p) => p.name)
      .sort((a, b) => {
        if (a.realtimeProvided !== b.realtimeProvided) {
          return a.realtimeProvided ? -1 : 1;
        }
        return (b.capacity ?? 0) - (a.capacity ?? 0);
      })
      .slice(0, 6);

    const rawSubStts = Array.isArray(cd.SUB_STTS) ? cd.SUB_STTS : [];
    const subwayStations: Array<{ name: string; line: string }> = [];
    const seenSubKey = new Set<string>();
    for (const s of rawSubStts) {
      const name = String(s.SUB_STN_NM ?? '').trim();
      const line = String(s.SUB_STN_LINE ?? '').trim();
      if (!name) continue;
      const key = `${name}|${line}`;
      if (seenSubKey.has(key)) continue;
      seenSubKey.add(key);
      subwayStations.push({ name, line });
    }

    const liveSubObj = (
      Array.isArray(cd.LIVE_SUB_PPLTN)
        ? cd.LIVE_SUB_PPLTN[0]
        : cd.LIVE_SUB_PPLTN
    ) as Record<string, unknown> | undefined;

    const liveBusObj = (
      Array.isArray(cd.LIVE_BUS_PPLTN)
        ? cd.LIVE_BUS_PPLTN[0]
        : cd.LIVE_BUS_PPLTN
    ) as Record<string, unknown> | undefined;

    const buildIntervals = (
      obj: Record<string, unknown> | undefined,
      prefix: 'SUB' | 'BUS'
    ): SeoulTransitIntervalStat[] => {
      if (!obj) return [];
      const defs: Array<[string, string]> = [
        ['당일 누적', `${prefix}_ACML`],
        ['최근 30분', `${prefix}_30WTHN`],
        ['최근 10분', `${prefix}_10WTHN`],
        ['최근 5분', `${prefix}_5WTHN`],
      ];
      return defs
        .map(([label, base]) => ({
          label,
          boardMin: toNumberOrNull(obj[`${base}_GTON_PPLTN_MIN`]),
          boardMax: toNumberOrNull(obj[`${base}_GTON_PPLTN_MAX`]),
          alightMin: toNumberOrNull(obj[`${base}_GTOFF_PPLTN_MIN`]),
          alightMax: toNumberOrNull(obj[`${base}_GTOFF_PPLTN_MAX`]),
        }))
        .filter(
          (item) =>
            item.boardMin !== null ||
            item.boardMax !== null ||
            item.alightMin !== null ||
            item.alightMax !== null
        );
    };

    const subwayIntervals = buildIntervals(liveSubObj, 'SUB');
    const busIntervals = buildIntervals(liveBusObj, 'BUS');
    const subwayStationCount =
      toNumberOrNull(liveSubObj?.SUB_STN_CNT) ??
      (subwayStations.length > 0 ? subwayStations.length : null);
    const busStationCount = toNumberOrNull(liveBusObj?.BUS_STN_CNT);

    const transit: SeoulTransitSummary | null =
      subwayIntervals.length > 0 || busIntervals.length > 0
        ? {
            subwayStationCount,
            subwayStations,
            subwayIntervals,
            busStationCount,
            busIntervals,
          }
        : null;

    const coreData: Omit<
      SeoulCityDataSummary,
      'configured' | 'supported' | 'distanceMeters' | 'nearbyHotspots'
    > = {
      areaCode: String(cd.AREA_CD ?? targetHotspot.code).trim(),
      areaName: String(cd.AREA_NM ?? targetHotspot.name).trim(),
      areaCategory: resolvedAreaCategory,
      areaPolygon: resolvedAreaPolygon,
      error: null,
      congestLevel: String(ppltn.AREA_CONGEST_LVL ?? '').trim(),
      congestMessage: String(ppltn.AREA_CONGEST_MSG ?? '').trim(),
      populationMin: toNumberOrNull(ppltn.AREA_PPLTN_MIN),
      populationMax: toNumberOrNull(ppltn.AREA_PPLTN_MAX),
      maleRate: toNumberOrNull(ppltn.MALE_PPLTN_RATE),
      femaleRate: toNumberOrNull(ppltn.FEMALE_PPLTN_RATE),
      residentRate: toNumberOrNull(ppltn.RESNT_PPLTN_RATE),
      nonResidentRate: toNumberOrNull(ppltn.NON_RESNT_PPLTN_RATE),
      ageRates,
      populationTime: String(ppltn.PPLTN_TIME ?? '').trim(),
      forecast,
      commercialLevel: String(cmrcl.AREA_CMRCL_LVL ?? '').trim(),
      commercialTime,
      shPaymentCount: toNumberOrNull(cmrcl.AREA_SH_PAYMENT_CNT),
      shPaymentMinWon: toNumberOrNull(cmrcl.AREA_SH_PAYMENT_AMT_MIN),
      shPaymentMaxWon: toNumberOrNull(cmrcl.AREA_SH_PAYMENT_AMT_MAX),
      commercialMaleRate: toNumberOrNull(cmrcl.CMRCL_MALE_RATE),
      commercialFemaleRate: toNumberOrNull(cmrcl.CMRCL_FEMALE_RATE),
      commercialAgeRates,
      commercialPersonalRate: toNumberOrNull(cmrcl.CMRCL_PERSONAL_RATE),
      commercialCorporationRate: toNumberOrNull(cmrcl.CMRCL_CORPORATION_RATE),
      commercialCategories,
      transit,
      roadTrafficLevel: String(avgRoad.ROAD_TRAFFIC_IDX ?? '').trim(),
      roadTrafficSpeedKmh: toNumberOrNull(avgRoad.ROAD_TRAFFIC_SPD),
      roadTrafficMessage: String(avgRoad.ROAD_MSG ?? '').trim(),
      temperatureC: toNumberOrNull(weather.TEMP),
      pm10: toNumberOrNull(weather.PM10),
      pm10Index: String(weather.PM10_INDEX ?? '').trim(),
      pm25: toNumberOrNull(weather.PM25),
      pm25Index: String(weather.PM25_INDEX ?? '').trim(),
      airIndex: String(weather.AIR_IDX ?? '').trim(),
      parkingTotalCount: rawPrk.length,
      parkingLots,
    };

    seoulCityDataCache.set(targetHotspot.code, {
      expiresAt: Date.now() + 1000 * 60 * 5,
      data: coreData,
    });

    return {
      ...coreData,
      configured: true,
      supported: true,
      distanceMeters: targetHotspot.distanceMeters,
      nearbyHotspots,
    };
  } catch (err) {
    const areaPolygonEntry = SEOUL_HOTSPOT_AREAS[targetHotspot.code];
    return {
      ...emptyBase,
      supported: true,
      areaCode: targetHotspot.code,
      areaName: targetHotspot.name,
      areaCategory: areaPolygonEntry?.category ?? '',
      areaPolygon: areaPolygonEntry?.rings ?? [],
      distanceMeters: targetHotspot.distanceMeters,
      nearbyHotspots,
      error:
        err instanceof Error
          ? err.message
          : '서울시 실시간 도시데이터 조회 실패',
    };
  }
}

function getApiSources(): ApiSourceSpec[] {
  const hasPublicData = isConfigured(process.env.PUBLIC_DATA_API_KEY);
  const hasReb = isConfigured(process.env.REB_API_KEY);
  const hasSchool = isConfigured(process.env.SCHOOL_INFO_API_KEY);
  const hasKakaoJs = isConfigured(process.env.KAKAO_JAVASCRIPT_API_KEY);
  const hasKakaoRest = isConfigured(process.env.KAKAO_REST_API_KEY);

  return [
    {
      id: 'schoolinfo',
      name: '학교알리미 공시정보',
      provider: '한국교육학술정보원 (schoolinfo.go.kr)',
      envVar: 'SCHOOL_INFO_API_KEY',
      configured: hasSchool,
      endpoint: 'https://www.schoolinfo.go.kr/openApi.do',
      requiredParams: ['apiKey', 'apiType (0/63/08)', 'sidoCode', 'sggCode', 'schulKndCode'],
      outputFields: [
        'SCHUL_NM (학교명)',
        'SCHUL_KND_SC_CODE (학교급)',
        'SUM (학생수) / ITRT_TCR_TOT_FGR (교원수)',
        'SCHUL_RDNMA (도로명주소)',
        'LTTUD / LGTUD (위도·경도)',
      ],
    },
    {
      id: 'commercial',
      name: '소상공인 상가(상권)정보',
      provider: '소상공인시장진흥공단 (data.go.kr)',
      envVar: 'PUBLIC_DATA_API_KEY',
      configured: hasPublicData,
      endpoint:
        'https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius',
      requiredParams: ['serviceKey', 'radius', 'cx (경도)', 'cy (위도)', 'type=json'],
      outputFields: [
        'bizesNm (상호명)',
        'indsLclsNm / indsMclsNm / indsSclsNm (업종 대·중·소분류)',
        'rdnmAdr (도로명주소)',
        'flrNo (층정보)',
        'lon / lat (좌표)',
      ],
    },
    {
      id: 'molit',
      name: '국토교통부 실거래가 (매매·전월세 10종)',
      provider: '국토교통부 (data.go.kr)',
      envVar: 'PUBLIC_DATA_API_KEY',
      configured: hasPublicData,
      endpoint:
        'https://apis.data.go.kr/1613000/RTMSDataSvc{AptTradeDev|AptRent|OffiTrade|OffiRent|RHTrade2|RHRent|SHTrade|SHRent|NrgTrade|LandTrade}',
      requiredParams: ['serviceKey', 'LAWD_CD (시군구 5자리)', 'DEAL_YMD (계약년월)'],
      outputFields: [
        'aptNm / offiNm / mhouseNm / houseType (단지·건물·주택유형)',
        'dealAmount / deposit / monthlyRent (거래·보증·월세)',
        'excluUseAr / totalFloorAr / buildingAr / dealArea (면적)',
        'jimok / landUse (지목·용도지역)',
      ],
    },
    {
      id: 'kapt',
      name: '국토교통부 공동주택 단지 목록',
      provider: '국토교통부 (data.go.kr)',
      envVar: 'PUBLIC_DATA_API_KEY',
      configured: hasPublicData,
      endpoint:
        'https://apis.data.go.kr/1613000/AptListService4/getSigunguAptList4',
      requiredParams: ['serviceKey', 'sigunguCode (5자리)'],
      outputFields: ['kaptCode (단지코드)', 'kaptName (단지명)', 'as3 (법정동)'],
    },
    {
      id: 'reb',
      name: '한국부동산원 R-ONE 통계',
      provider: '한국부동산원 (reb.or.kr/r-one)',
      envVar: 'REB_API_KEY',
      configured: hasReb,
      endpoint: 'https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do',
      requiredParams: ['KEY', 'STATBL_ID', 'DTACYCLE_CD=MM', 'WRTTIME_IDTFR_ID'],
      outputFields: [
        'STATBL_NM (통계표명)',
        'CLS_FULLNM (지역)',
        'WRTTIME_DESC (기준시점)',
        'DTA_VAL (지수·변동률)',
        'UI_NM (단위)',
      ],
    },
    {
      id: 'kakao-map',
      name: '카카오맵 JavaScript 지도',
      provider: '카카오 (developers.kakao.com)',
      envVar: 'KAKAO_JAVASCRIPT_API_KEY',
      configured: hasKakaoJs,
      endpoint: 'https://dapi.kakao.com/v2/maps/sdk.js',
      requiredParams: ['appkey', 'libraries=services'],
      outputFields: ['일반지도(ROADMAP) · 위성지도(HYBRID) · 반경원 · 마커'],
    },
    {
      id: 'kakao-local',
      name: '카카오 로컬 주소·단지 검색',
      provider: '카카오 (developers.kakao.com)',
      envVar: 'KAKAO_REST_API_KEY',
      configured: hasKakaoRest,
      endpoint:
        'https://dapi.kakao.com/v2/local/search/{address|keyword}.json',
      requiredParams: ['Authorization: KakaoAK', 'query / page / x, y'],
      outputFields: [
        'place_name / category_name (단지·건물·카테고리)',
        'road_address_name / address_name (도로명·지번)',
        'x/y (위경도) · b_code (법정동코드)',
      ],
    },
    {
      id: 'building-register',
      name: '건축HUB 건축물대장정보',
      provider: '국토교통부 (data.go.kr)',
      envVar: 'PUBLIC_DATA_API_KEY',
      configured: hasPublicData,
      endpoint: 'https://apis.data.go.kr/1613000/BldRgstHubService',
      requiredParams: ['serviceKey', 'sigunguCd', 'bjdongCd', 'platGbCd', 'bun', 'ji'],
      outputFields: [
        'vlRat / bcRat (용적률·건폐율)',
        'platArea / totArea (대지·연면적)',
        'hhldCnt / totPkngCnt (세대수·주차대수)',
        'useAprDay / jijiguCdNm (사용승인일·용도지역)',
      ],
    },
    {
      id: 'closed-register',
      name: '건축HUB 폐쇄말소대장정보',
      provider: '국토교통부 (data.go.kr)',
      envVar: 'PUBLIC_DATA_API_KEY',
      configured: hasPublicData,
      endpoint: 'https://apis.data.go.kr/1613000/ShtRgstHubService',
      requiredParams: ['serviceKey', 'sigunguCd', 'bjdongCd', 'bun', 'ji'],
      outputFields: [
        'shterGbCdNm / shterDay (말소구분·말소일자)',
        'bldNm / dongNm (말소 건물명)',
        'mainPurpsCdNm / totArea (구 용도·연면적)',
      ],
    },
    {
      id: 'seoul-citydata',
      name: '서울시 실시간 도시데이터',
      provider: '서울 열린데이터 광장 (data.seoul.go.kr)',
      envVar: 'SEOUL_OPEN_DATA_API_KEY',
      configured: isConfigured(process.env.SEOUL_OPEN_DATA_API_KEY),
      endpoint: 'http://openapi.seoul.go.kr:8088/{KEY}/json/citydata/1/5/{AREA}',
      requiredParams: ['KEY', 'AREA_NM / AREA_CD (서울 주요 거점 122곳)'],
      outputFields: [
        'LIVE_PPLTN_STTS (실시간 인구·혼잡도·상주비율)',
        'LIVE_CMRCL_STTS (상권 활성도·카드 결제 건수·금액)',
        'ROAD_TRAFFIC_STTS / PRK_STTS / WEATHER_STTS',
      ],
    },
  ];
}

function parsePropertyType(raw: unknown): PropertyType {
  switch (raw) {
    case 'aptRent':
    case 'officetel':
    case 'officetelRent':
    case 'rowhouse':
    case 'rowhouseRent':
    case 'detached':
    case 'detachedRent':
    case 'commercial':
    case 'land':
      return raw;
    default:
      return 'apt';
  }
}

function parseQueryParams(q: express.Request['query']): LocationQueryParams {
  const sidoCode = String(q.sidoCode ?? '11').trim();
  const sggCode = String(q.sggCode ?? '11680').trim();
  const dongCode = String(q.dongCode ?? '').trim();
  const dongName = String(q.dongName ?? '').trim();
  const complexName = String(q.complexName ?? '').trim();
  const lat = String(q.lat ?? '37.5172').trim();
  const lng = String(q.lng ?? '127.0473').trim();
  const radiusRaw = Number(q.radius ?? 500);
  const radius = Number.isFinite(radiusRaw) && radiusRaw > 0 ? radiusRaw : 500;
  const dealYmd = String(q.dealYmd ?? '202610').trim();
  const propertyType = parsePropertyType(q.propertyType);
  const schulKndCode = String(q.schulKndCode ?? '').trim();
  const manualCoords = q.manualCoords === 'true';

  return {
    sidoCode,
    sggCode,
    dongCode,
    dongName,
    complexName,
    lat,
    lng,
    radius,
    dealYmd,
    propertyType,
    schulKndCode,
    manualCoords,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/sources', (_req, res) => {
    res.json({ sources: getApiSources() });
  });

  app.get('/api/map/config', (_req, res) => {
    const jsKey = process.env.KAKAO_JAVASCRIPT_API_KEY;
    if (!isConfigured(jsKey)) {
      res.json({ configured: false, jsKey: null });
      return;
    }
    res.json({
      configured: true,
      jsKey: jsKey.trim(),
    });
  });

  app.get('/api/region/options', async (req, res) => {
    const params = parseQueryParams(req.query);
    const data = await fetchRegionOptions({
      sidoCode: params.sidoCode,
      sggCode: params.sggCode,
      dealYmd: params.dealYmd,
    });
    res.json(data);
  });

  app.get('/api/geocode', async (req, res) => {
    const query = String(req.query.query ?? '').trim();
    const pageRaw = Number(req.query.page ?? 1);
    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
    if (!query) {
      res.status(400).json({ error: '검색할 주소 또는 단지명을 입력하세요.' });
      return;
    }
    const result = await fetchGeocode(query, page);
    res.json(result);
  });

  app.get('/api/geocode/resolve', async (req, res) => {
    const lat = toNumberOrNull(req.query.lat);
    const lng = toNumberOrNull(req.query.lng);
    if (lat === null || lng === null) {
      res.status(400).json({ error: '유효한 좌표가 필요합니다.' });
      return;
    }
    const rev = await reverseLookupRegionByCoords(lat, lng);
    res.json(rev ?? { sidoCode: '', sggCode: '', sidoName: '', sggName: '', dongName: '' });
  });

  app.get('/api/schools', async (req, res) => {
    const params = parseQueryParams(req.query);
    const result = await fetchSchools({
      sidoCode: params.sidoCode,
      sggCode: params.sggCode,
      schulKndCode: params.schulKndCode,
      centerLat: toNumberOrNull(params.lat),
      centerLng: toNumberOrNull(params.lng),
    });
    res.json(result);
  });

  app.get('/api/commercial', async (req, res) => {
    const params = parseQueryParams(req.query);
    const result = await fetchCommercial({
      lat: params.lat,
      lng: params.lng,
      radius: params.radius,
      dongCode: params.dongCode,
    });
    res.json(result);
  });

  app.get('/api/transactions', async (req, res) => {
    const params = parseQueryParams(req.query);
    const result = await fetchTransactions({
      lawdCd: params.sggCode,
      dealYmd: params.dealYmd,
      propertyType: params.propertyType,
      dongName: params.dongName,
      complexName: params.complexName,
    });
    res.json(result);
  });

  app.get('/api/reb', async (req, res) => {
    const params = parseQueryParams(req.query);
    const result = await fetchRebStats({
      sidoCode: params.sidoCode,
      sggCode: params.sggCode,
      dealYmd: params.dealYmd,
    });
    res.json(result);
  });

  app.get('/api/seoul-citydata', async (req, res) => {
    const lat = toNumberOrNull(req.query.lat);
    const lng = toNumberOrNull(req.query.lng);
    const areaCode = String(req.query.areaCode ?? '').trim() || undefined;
    const data = await fetchSeoulCityData({
      centerLat: lat,
      centerLng: lng,
      areaCodeOverride: areaCode,
    });
    res.json(data);
  });

  app.get('/api/analysis', async (req, res) => {
    const params = parseQueryParams(req.query);

    const { resolvedLocation, effectiveSidoCode, effectiveSggCode } =
      await resolveTargetLocation({
        sidoCode: params.sidoCode,
        sggCode: params.sggCode,
        dongName: params.dongName,
        complexName: params.complexName,
        propertyType: params.propertyType,
        dealYmd: params.dealYmd,
        fallbackLat: params.lat,
        fallbackLng: params.lng,
        manualCoords: params.manualCoords,
      });

    const effectiveLat =
      resolvedLocation.lat !== null ? String(resolvedLocation.lat) : params.lat;
    const effectiveLng =
      resolvedLocation.lng !== null ? String(resolvedLocation.lng) : params.lng;

    const [
      schools,
      commercial,
      transactions,
      reb,
      subways,
      busStops,
      hospitals,
      buildingRegister,
      seoulCityData,
    ] = await Promise.all([
      fetchSchools({
        sidoCode: effectiveSidoCode,
        sggCode: effectiveSggCode,
        schulKndCode: params.schulKndCode,
        centerLat: resolvedLocation.lat,
        centerLng: resolvedLocation.lng,
      }),
      fetchCommercial({
        lat: effectiveLat,
        lng: effectiveLng,
        radius: params.radius,
        dongCode: params.dongCode,
      }),
      fetchTransactions({
        lawdCd: effectiveSggCode,
        dealYmd: params.dealYmd,
        propertyType: params.propertyType,
        dongName: params.dongName,
        complexName: params.complexName,
      }),
      fetchRebStats({
        sidoCode: effectiveSidoCode,
        sggCode: effectiveSggCode,
        dealYmd: params.dealYmd,
        sidoNameOverride: resolvedLocation.sidoName,
        sggNameOverride: resolvedLocation.sggName,
      }),
      fetchNearbySubwayStations({
        centerLat: resolvedLocation.lat,
        centerLng: resolvedLocation.lng,
        radius: params.radius,
      }),
      fetchNearbyBusStops({
        centerLat: resolvedLocation.lat,
        centerLng: resolvedLocation.lng,
        radius: params.radius,
      }),
      fetchNearbyHospitals({
        sggCode: effectiveSggCode,
        centerLat: resolvedLocation.lat,
        centerLng: resolvedLocation.lng,
        radius: params.radius,
      }),
      fetchBuildingRegister({
        centerLat: resolvedLocation.lat,
        centerLng: resolvedLocation.lng,
        complexName: resolvedLocation.complexName || params.complexName,
      }),
      fetchSeoulCityData({
        centerLat: resolvedLocation.lat,
        centerLng: resolvedLocation.lng,
      }),
    ]);

    const payload: AnalysisResponse = {
      queriedAt: new Date().toISOString(),
      params: {
        ...params,
        sidoCode: effectiveSidoCode,
        sggCode: effectiveSggCode,
        lat: effectiveLat,
        lng: effectiveLng,
      },
      resolvedLocation,
      schools,
      commercial,
      subways,
      busStops,
      hospitals,
      buildingRegister,
      seoulCityData,
      transactions,
      reb,
    };
    res.json(payload);
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
