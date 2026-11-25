import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, MapPin, Search } from 'lucide-react';
import {
  KOREA_REGIONS,
  RADIUS_OPTIONS,
  SIDO_NAMES_BY_CODE,
  findRegionBySggCode,
} from '../data/regions.ts';
import type {
  GeocodeResult,
  LocationQueryParams,
  PropertyType,
  RegionOptionsResponse,
  ResolvedLocationInfo,
  SearchPlaceCandidate,
} from '../types/analysis.ts';
import { AddressSearchModal } from './AddressSearchModal.tsx';

interface QueryControlBarProps {
  params: LocationQueryParams;
  regionOptions: RegionOptionsResponse;
  loadingOptions: boolean;
  resolvedLocation?: ResolvedLocationInfo | null;
  onChange: (next: LocationQueryParams) => void;
  onExecute: (override?: LocationQueryParams) => void;
  loading: boolean;
}

const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  apt: '아파트 매매',
  aptRent: '아파트 전월세',
  officetel: '오피스텔 매매',
  officetelRent: '오피스텔 전월세',
  rowhouse: '연립·다세대 매매',
  rowhouseRent: '연립·다세대 전월세',
  detached: '단독·다가구 매매',
  detachedRent: '단독·다가구 전월세',
  commercial: '상업·업무용 매매',
  land: '토지 매매',
};

function isComplexSupported(type: PropertyType): boolean {
  return (
    type === 'apt' ||
    type === 'aptRent' ||
    type === 'officetel' ||
    type === 'officetelRent'
  );
}

export const QueryControlBar: React.FC<QueryControlBarProps> = ({
  params,
  regionOptions,
  loadingOptions,
  resolvedLocation,
  onChange,
  onExecute,
  loading,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [addressQuery, setAddressQuery] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeNote, setGeocodeNote] = useState<string | null>(null);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [modalState, setModalState] = useState<{
    query: string;
    candidates: SearchPlaceCandidate[];
    totalCount: number;
    pageableCount: number;
    page: number;
    isEnd: boolean;
    error: string | null;
  }>({
    query: '',
    candidates: [],
    totalCount: 0,
    pageableCount: 0,
    page: 1,
    isEnd: true,
    error: null,
  });
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const selectedSido = useMemo(() => {
    const found = KOREA_REGIONS.find((r) => r.sidoCode === params.sidoCode);
    if (found) return found;
    return {
      sidoCode: params.sidoCode,
      name:
        resolvedLocation?.sidoName ||
        SIDO_NAMES_BY_CODE[params.sidoCode] ||
        params.sidoCode,
      districts: [],
    };
  }, [params.sidoCode, resolvedLocation?.sidoName]);

  const hasSelectedSidoOption = KOREA_REGIONS.some(
    (r) => r.sidoCode === params.sidoCode
  );
  const hasSelectedSggOption = selectedSido.districts.some(
    (d) => d.sggCode === params.sggCode
  );

  const complexSupported = isComplexSupported(params.propertyType);

  const availableComplexes = useMemo(() => {
    if (!complexSupported) return [];
    return regionOptions.complexes.filter((c) => {
      if (params.dongName && c.dongName !== params.dongName) return false;
      if (
        (params.propertyType === 'apt' || params.propertyType === 'aptRent') &&
        c.type !== 'apt'
      ) {
        return false;
      }
      if (
        (params.propertyType === 'officetel' ||
          params.propertyType === 'officetelRent') &&
        c.type !== 'officetel'
      ) {
        return false;
      }
      return true;
    });
  }, [
    regionOptions.complexes,
    params.dongName,
    params.propertyType,
    complexSupported,
  ]);

  const handleSidoChange = (sidoCode: string) => {
    const region = KOREA_REGIONS.find((r) => r.sidoCode === sidoCode);
    const firstDistrict = region?.districts[0];
    onChange({
      ...params,
      sidoCode,
      sggCode: firstDistrict ? firstDistrict.sggCode : params.sggCode,
      dongName: '',
      complexName: '',
      lat: firstDistrict ? firstDistrict.defaultLat : '',
      lng: firstDistrict ? firstDistrict.defaultLng : '',
      manualCoords: false,
    });
  };

  const handleSggChange = (sggCode: string) => {
    const district = selectedSido.districts.find((d) => d.sggCode === sggCode);
    onChange({
      ...params,
      sggCode,
      dongName: '',
      complexName: '',
      lat: district ? district.defaultLat : '',
      lng: district ? district.defaultLng : '',
      manualCoords: false,
    });
  };

  const handleDongChange = (dongName: string) => {
    const next: LocationQueryParams = {
      ...params,
      dongName,
      complexName: '',
      manualCoords: false,
    };
    onChange(next);
    onExecute(next);
  };

  const handlePropertyTypeChange = (propertyType: PropertyType) => {
    const bothApt =
      (params.propertyType === 'apt' || params.propertyType === 'aptRent') &&
      (propertyType === 'apt' || propertyType === 'aptRent');
    const bothOffi =
      (params.propertyType === 'officetel' ||
        params.propertyType === 'officetelRent') &&
      (propertyType === 'officetel' || propertyType === 'officetelRent');
    const keepComplex = bothApt || bothOffi;

    const next: LocationQueryParams = {
      ...params,
      propertyType,
      complexName: keepComplex ? params.complexName : '',
      manualCoords: keepComplex ? params.manualCoords : false,
    };
    onChange(next);
    onExecute(next);
  };

  const handleComplexChange = (complexName: string) => {
    const matched = availableComplexes.find((c) => c.name === complexName);
    const next: LocationQueryParams = {
      ...params,
      complexName,
      dongName: matched?.dongName || params.dongName,
      manualCoords: false,
    };
    onChange(next);
    onExecute(next);
  };

  const applySelectedCandidate = async (
    candidate: SearchPlaceCandidate,
    prefetchedRegion?: {
      sidoCode?: string;
      sggCode?: string;
      sidoName?: string;
      sggName?: string;
      dongName?: string;
    }
  ) => {
    setResolvingId(candidate.id);
    try {
      let sggCode = candidate.sggCode || prefetchedRegion?.sggCode || '';
      let sidoCode = candidate.sidoCode || prefetchedRegion?.sidoCode || '';
      let sidoName = candidate.sidoName || prefetchedRegion?.sidoName || '';
      let sggName = candidate.sggName || prefetchedRegion?.sggName || '';
      let dongName = candidate.dongName || prefetchedRegion?.dongName || '';

      if (!sggCode || sggCode.length < 5) {
        const revRes = await fetch(
          `/api/geocode/resolve?lat=${encodeURIComponent(
            String(candidate.lat)
          )}&lng=${encodeURIComponent(String(candidate.lng))}`
        );
        if (revRes.ok) {
          const rev = (await revRes.json()) as {
            sidoCode?: string;
            sggCode?: string;
            sidoName?: string;
            sggName?: string;
            dongName?: string;
          };
          sidoCode = rev.sidoCode || sidoCode;
          sggCode = rev.sggCode || sggCode;
          sidoName = rev.sidoName || sidoName;
          sggName = rev.sggName || sggName;
          dongName = rev.dongName || dongName;
        }
      }

      const nextSggCode =
        sggCode && /^\d{5}$/.test(sggCode) ? sggCode : params.sggCode;
      const nextSidoCode =
        sidoCode && sidoCode.length >= 2
          ? sidoCode
          : nextSggCode.length === 5
            ? nextSggCode.slice(0, 2)
            : params.sidoCode;

      const next: LocationQueryParams = {
        ...params,
        sidoCode: nextSidoCode,
        sggCode: nextSggCode,
        dongName: '',
        complexName: '',
        lat: candidate.lat.toFixed(6),
        lng: candidate.lng.toFixed(6),
        manualCoords: true,
      };
      onChange(next);
      onExecute(next);
      setSearchModalOpen(false);

      const displayAddr =
        candidate.roadAddress || candidate.lotAddress || candidate.placeName;
      const regionSuffix =
        sidoName || sggName
          ? ` (${[sidoName, sggName, dongName].filter(Boolean).join(' ')})`
          : '';
      const prefix =
        candidate.placeName && candidate.placeName !== displayAddr
          ? `${candidate.placeName} · `
          : '';
      setGeocodeNote(`${prefix}${displayAddr}${regionSuffix} 위치로 이동했습니다.`);
    } catch {
      setGeocodeNote('선택한 위치의 행정구역 확인 중 오류가 발생했습니다.');
    } finally {
      setResolvingId(null);
    }
  };

  const runGeocodeQuery = async (
    rawQuery: string,
    page = 1,
    fromModal = false
  ) => {
    const trimmed = rawQuery.trim();
    if (!trimmed) return;

    setGeocoding(true);
    setGeocodeNote(null);

    try {
      const res = await fetch(
        `/api/geocode?query=${encodeURIComponent(trimmed)}&page=${page}`
      );
      const data = (await res.json()) as GeocodeResult;
      const candidates = data.candidates ?? [];

      setModalState({
        query: trimmed,
        candidates,
        totalCount: data.totalCount ?? candidates.length,
        pageableCount: data.pageableCount ?? candidates.length,
        page: data.page ?? page,
        isEnd: data.isEnd ?? true,
        error: data.error,
      });

      if (!fromModal && page === 1 && candidates.length === 1) {
        await applySelectedCandidate(candidates[0], data);
        return;
      }

      if (candidates.length > 0 || fromModal) {
        setSearchModalOpen(true);
      } else {
        setGeocodeNote(data.error || '일치하는 주소 또는 단지를 찾지 못했습니다.');
      }
    } catch {
      setGeocodeNote('카카오 주소·단지 검색 요청 중 오류가 발생했습니다.');
    } finally {
      setGeocoding(false);
    }
  };

  const handleGeocode = (e: React.FormEvent) => {
    e.preventDefault();
    void runGeocodeQuery(addressQuery, 1, false);
  };

  return (
    <section
      aria-label="대상지 조건 설정"
      className="bg-white border-b border-slate-200 px-6 py-4 space-y-3"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="sido-select"
            className="text-[11px] font-medium text-slate-500"
          >
            시 · 도
          </label>
          <select
            id="sido-select"
            value={params.sidoCode}
            onChange={(e) => handleSidoChange(e.target.value)}
            className="h-9 px-2.5 text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
          >
            {!hasSelectedSidoOption && params.sidoCode && (
              <option value={params.sidoCode}>{selectedSido.name}</option>
            )}
            {KOREA_REGIONS.map((sido) => (
              <option key={sido.sidoCode} value={sido.sidoCode}>
                {sido.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="sgg-select"
            className="text-[11px] font-medium text-slate-500"
          >
            시 · 군 · 구
          </label>
          <select
            id="sgg-select"
            value={params.sggCode}
            onChange={(e) => handleSggChange(e.target.value)}
            className="h-9 px-2.5 text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
          >
            {!hasSelectedSggOption && params.sggCode && (
              <option value={params.sggCode}>
                {resolvedLocation?.sggName || params.sggCode}
              </option>
            )}
            {selectedSido.districts.map((dist) => (
              <option key={dist.sggCode} value={dist.sggCode}>
                {dist.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="dong-select"
            className="text-[11px] font-medium text-slate-500"
          >
            동 단위 (법정동)
          </label>
          <select
            id="dong-select"
            value={params.dongName}
            onChange={(e) => handleDongChange(e.target.value)}
            disabled={loadingOptions && regionOptions.dongs.length === 0}
            className="h-9 px-2.5 text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
          >
            <option value="">
              {loadingOptions && regionOptions.dongs.length === 0
                ? '동 목록 불러오는 중...'
                : '구 전체'}
            </option>
            {regionOptions.dongs.map((dong) => (
              <option key={dong} value={dong}>
                {dong}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="property-type-select"
            className="text-[11px] font-medium text-slate-500"
          >
            대상 유형
          </label>
          <select
            id="property-type-select"
            value={params.propertyType}
            onChange={(e) =>
              handlePropertyTypeChange(e.target.value as PropertyType)
            }
            className="h-9 px-2.5 text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
          >
            <option value="apt">아파트 매매</option>
            <option value="aptRent">아파트 전월세</option>
            <option value="officetel">오피스텔 매매</option>
            <option value="officetelRent">오피스텔 전월세</option>
            <option value="rowhouse">연립·다세대 매매</option>
            <option value="rowhouseRent">연립·다세대 전월세</option>
            <option value="detached">단독·다가구 매매</option>
            <option value="detachedRent">단독·다가구 전월세</option>
            <option value="commercial">상업·업무용 매매</option>
            <option value="land">토지 매매</option>
          </select>
        </div>

        <div className="flex flex-col gap-1 col-span-2 md:col-span-2 xl:col-span-2">
          <label
            htmlFor="complex-select"
            className="text-[11px] font-medium text-slate-500"
          >
            특정 아파트 · 오피스텔 기준
          </label>
          <select
            id="complex-select"
            value={params.complexName}
            onChange={(e) => handleComplexChange(e.target.value)}
            disabled={
              !complexSupported ||
              (loadingOptions && availableComplexes.length === 0)
            }
            className="h-9 px-2.5 text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">
              {!complexSupported
                ? `${PROPERTY_TYPE_LABELS[params.propertyType]}은 동/구 단위 조회`
                : availableComplexes.length === 0 && loadingOptions
                  ? '단지 목록 불러오는 중...'
                  : params.dongName
                    ? `${params.dongName} 전체 (${availableComplexes.length}개 단지)`
                    : `전체 단지 (${availableComplexes.length}개)`}
            </option>
            {availableComplexes.map((c) => (
              <option
                key={`${c.type}:${c.dongName}:${c.name}`}
                value={c.name}
              >
                {params.dongName ? c.name : `${c.name} (${c.dongName})`}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="radius-select"
            className="text-[11px] font-medium text-slate-500"
          >
            상권 반경
          </label>
          <select
            id="radius-select"
            value={params.radius}
            onChange={(e) =>
              onChange({ ...params, radius: Number(e.target.value) })
            }
            className="h-9 px-2.5 text-xs font-mono tabular-nums bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
          >
            {RADIUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="dealymd-input"
            className="text-[11px] font-medium text-slate-500"
          >
            기준월 (YYYYMM)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="dealymd-input"
              type="text"
              maxLength={6}
              value={params.dealYmd}
              onChange={(e) =>
                onChange({ ...params, dealYmd: e.target.value.trim() })
              }
              className="h-9 w-24 px-2.5 text-xs font-mono tabular-nums bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
            />
            <button
              type="button"
              onClick={() => onExecute()}
              disabled={loading}
              className="h-9 px-3.5 bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer transition-colors flex-1"
            >
              <Search className="w-3.5 h-3.5" />
              {loading ? '조회 중...' : '조회'}
            </button>
          </div>
        </div>
      </div>

      {/* 특정 위치 주소·단지 검색 (카카오 로컬 API) + 기준 위치 요약 + 세부 좌표 토글 */}
      <div className="pt-1 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <form
          onSubmit={handleGeocode}
          className="flex items-center gap-2 flex-1 max-w-xl"
        >
          <div className="relative flex-1">
            <MapPin className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={addressQuery}
              onChange={(e) => setAddressQuery(e.target.value)}
              placeholder="주소 · 아파트 · 건물명 검색 (예: 현대아파트, 삼성로135길 42)"
              className="w-full h-8 pl-8 pr-3 text-xs bg-slate-50 border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-blue-600"
            />
          </div>
          <button
            type="submit"
            disabled={geocoding || !addressQuery.trim()}
            className="h-8 px-3 text-xs font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {geocoding ? '검색 중...' : '위치 검색'}
          </button>
        </form>

        <div className="flex flex-wrap items-center justify-between lg:justify-end gap-4 min-w-0">
          <div className="text-xs text-slate-500 flex items-center gap-2 min-w-0">
            {resolvedLocation ? (
              <>
                <span className="font-medium text-slate-800 truncate">
                  {resolvedLocation.label}
                </span>
                <span className="text-slate-300" aria-hidden="true">
                  ·
                </span>
                <span className="text-slate-500 whitespace-nowrap shrink-0">
                  {resolvedLocation.resolutionSource}
                </span>
              </>
            ) : (
              <span>{'\u00A0'}</span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {showAdvanced ? (
              <>
                세부 코드·좌표 접기
                <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                세부 코드·좌표
                <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {geocodeNote && (
        <div className="pt-1 flex items-center justify-between gap-3 text-xs text-slate-600">
          <span>{geocodeNote}</span>
          {modalState.candidates.length > 1 && (
            <button
              type="button"
              onClick={() => setSearchModalOpen(true)}
              className="text-blue-700 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              다른 검색 결과 선택 ({modalState.totalCount.toLocaleString('ko-KR')}건)
            </button>
          )}
        </div>
      )}

      {showAdvanced && (
        <div className="pt-3 border-t border-slate-200 flex flex-wrap items-end justify-end gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="lawd-input"
              className="text-[11px] font-medium text-slate-500"
            >
              법정동·시군구 코드
            </label>
            <input
              id="lawd-input"
              type="text"
              value={params.sggCode}
              maxLength={5}
              onChange={(e) => {
                const code = e.target.value.trim();
                if (/^\d{5}$/.test(code)) {
                  const known = findRegionBySggCode(code);
                  const next: LocationQueryParams = {
                    ...params,
                    sidoCode: known ? known.sido.sidoCode : code.slice(0, 2),
                    sggCode: code,
                    dongName: '',
                    complexName: '',
                    lat: known ? known.district.defaultLat : '',
                    lng: known ? known.district.defaultLng : '',
                    manualCoords: false,
                  };
                  onChange(next);
                  onExecute(next);
                } else {
                  onChange({
                    ...params,
                    sggCode: code,
                    manualCoords: false,
                  });
                }
              }}
              className="h-9 w-24 px-2.5 text-xs font-mono tabular-nums bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="lat-input"
              className="text-[11px] font-medium text-slate-500"
            >
              위도
            </label>
            <input
              id="lat-input"
              type="text"
              value={params.lat}
              onChange={(e) =>
                onChange({
                  ...params,
                  lat: e.target.value,
                  manualCoords: true,
                })
              }
              className="h-9 w-28 px-2.5 text-xs font-mono tabular-nums bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="lng-input"
              className="text-[11px] font-medium text-slate-500"
            >
              경도
            </label>
            <input
              id="lng-input"
              type="text"
              value={params.lng}
              onChange={(e) =>
                onChange({
                  ...params,
                  lng: e.target.value,
                  manualCoords: true,
                })
              }
              className="h-9 w-28 px-2.5 text-xs font-mono tabular-nums bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>
      )}

      <AddressSearchModal
        open={searchModalOpen}
        initialQuery={modalState.query || addressQuery}
        candidates={modalState.candidates}
        totalCount={modalState.totalCount}
        pageableCount={modalState.pageableCount}
        page={modalState.page}
        isEnd={modalState.isEnd}
        loading={geocoding}
        resolvingId={resolvingId}
        error={modalState.error}
        onClose={() => setSearchModalOpen(false)}
        onSearch={(q, p) => {
          setAddressQuery(q);
          void runGeocodeQuery(q, p, true);
        }}
        onSelect={(cand) => {
          void applySelectedCandidate(cand);
        }}
      />
    </section>
  );
};
