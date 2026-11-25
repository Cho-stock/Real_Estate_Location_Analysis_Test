import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Layers } from 'lucide-react';
import type {
  BusStopRecord,
  CommercialStoreRecord,
  HospitalRecord,
  MapConfigResponse,
  SchoolRecord,
  SubwayStationRecord,
} from '../types/analysis.ts';

type KakaoLayerMode = 'roadmap' | 'satellite';

interface KakaoLatLng {
  getLat(): number;
  getLng(): number;
}

interface KakaoLatLngBounds {
  extend(latlng: KakaoLatLng): void;
}

interface KakaoMapInstance {
  setCenter(latlng: KakaoLatLng): void;
  setLevel(level: number, options?: { animate?: boolean }): void;
  setBounds(
    bounds: KakaoLatLngBounds,
    paddingTop?: number,
    paddingRight?: number,
    paddingBottom?: number,
    paddingLeft?: number
  ): void;
  setMapTypeId(mapTypeId: unknown): void;
  setCursor(cursor: string): void;
  relayout(): void;
}

interface KakaoOverlay {
  setMap(map: KakaoMapInstance | null): void;
}

interface KakaoMapsNamespace {
  load(callback: () => void): void;
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  LatLngBounds: new () => KakaoLatLngBounds;
  Map: new (
    container: HTMLElement,
    options: { center: KakaoLatLng; level: number }
  ) => KakaoMapInstance;
  Circle: new (options: {
    center: KakaoLatLng;
    radius: number;
    strokeWeight?: number;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeStyle?: string;
    fillColor?: string;
    fillOpacity?: number;
  }) => KakaoOverlay;
  Polygon: new (options: {
    path: KakaoLatLng[] | KakaoLatLng[][];
    strokeWeight?: number;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeStyle?: string;
    fillColor?: string;
    fillOpacity?: number;
  }) => KakaoOverlay;
  CustomOverlay: new (options: {
    position: KakaoLatLng;
    content: HTMLElement | string;
    xAnchor?: number;
    yAnchor?: number;
    zIndex?: number;
    clickable?: boolean;
  }) => KakaoOverlay;
  ZoomControl: new () => unknown;
  ControlPosition: {
    TOPRIGHT: unknown;
    RIGHT: unknown;
  };
  MapTypeId: {
    ROADMAP: unknown;
    HYBRID: unknown;
  };
  event: {
    addListener(
      target: unknown,
      type: string,
      handler: (mouseEvent?: { latLng?: KakaoLatLng }) => void
    ): void;
  };
}

declare global {
  interface Window {
    kakao?: {
      maps?: KakaoMapsNamespace;
    };
  }
}

export interface HighlightedCommercialArea {
  areaCode: string;
  areaName: string;
  areaCategory: string;
  congestLevel?: string;
  commercialLevel?: string;
  rings: Array<Array<[number, number]>>;
}

interface KakaoMapProps {
  centerLat: string;
  centerLng: string;
  radiusMeters: number;
  targetLabel?: string;
  schools: SchoolRecord[];
  stores: CommercialStoreRecord[];
  subways?: SubwayStationRecord[];
  busStops?: BusStopRecord[];
  hospitals?: HospitalRecord[];
  highlightedArea?: HighlightedCommercialArea | null;
  onClearHighlightedArea?: () => void;
  loading?: boolean;
  onSelectCenter?: (lat: string, lng: string) => void;
}

let sdkLoadPromise: Promise<KakaoMapsNamespace> | null = null;
let loadedJsKey: string | null = null;

function loadKakaoMapsSdk(jsKey: string): Promise<KakaoMapsNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('브라우저 환경이 아닙니다.'));
  }

  if (window.kakao?.maps?.Map && loadedJsKey === jsKey) {
    return Promise.resolve(window.kakao.maps);
  }

  if (sdkLoadPromise && loadedJsKey === jsKey) {
    return sdkLoadPromise;
  }

  loadedJsKey = jsKey;
  sdkLoadPromise = new Promise<KakaoMapsNamespace>((resolve, reject) => {
    const scriptId = 'kakao-maps-sdk-script';
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (existing) {
      existing.remove();
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(
      jsKey
    )}&libraries=services&autoload=false`;

    script.onload = () => {
      const maps = window.kakao?.maps;
      if (!maps || typeof maps.load !== 'function') {
        sdkLoadPromise = null;
        reject(new Error('카카오맵 SDK 초기화에 실패했습니다.'));
        return;
      }
      maps.load(() => {
        if (window.kakao?.maps?.Map) {
          resolve(window.kakao.maps);
        } else {
          sdkLoadPromise = null;
          reject(new Error('카카오맵 Map 객체를 찾지 못했습니다.'));
        }
      });
    };

    script.onerror = () => {
      sdkLoadPromise = null;
      reject(new Error('카카오맵 SDK 스크립트 로드 실패 (도메인 등록 확인 필요)'));
    };

    document.head.appendChild(script);
  });

  return sdkLoadPromise;
}

function getKakaoLevelForRadius(radiusMeters: number): number {
  if (radiusMeters <= 300) return 3;
  if (radiusMeters <= 500) return 4;
  if (radiusMeters <= 1000) return 5;
  return 6;
}

function getMarkerDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  precomputed: number | null
): number {
  if (precomputed !== null && Number.isFinite(precomputed)) {
    return precomputed;
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
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function createPopupElement(params: {
  title: string;
  subtitle?: string;
  subtitleColor?: string;
  address?: string;
  meta?: string;
  onClose: () => void;
}): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText =
    'background:#FFFFFF;border:1px solid #CBD5E1;box-shadow:0 4px 12px rgba(15,23,42,0.16);padding:10px 12px;min-width:190px;max-width:270px;font-family:var(--font-sans);font-size:12px;line-height:1.45;color:#0F172A;white-space:normal;';

  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;align-items:flex-start;justify-content:space-between;gap:8px;';

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-weight:600;color:#0F172A;word-break:keep-all;';
  titleEl.textContent = params.title;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.style.cssText =
    'border:none;background:transparent;color:#64748B;font-size:15px;line-height:1;cursor:pointer;padding:0 2px;flex-shrink:0;';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    params.onClose();
  });

  header.appendChild(titleEl);
  header.appendChild(closeBtn);
  card.appendChild(header);

  if (params.subtitle) {
    const subEl = document.createElement('div');
    subEl.style.cssText = `margin-top:2px;font-size:11px;font-weight:500;color:${
      params.subtitleColor || '#1D4ED8'
    };word-break:keep-all;`;
    subEl.textContent = params.subtitle;
    card.appendChild(subEl);
  }

  if (params.address) {
    const addrEl = document.createElement('div');
    addrEl.style.cssText =
      'margin-top:4px;font-size:11px;color:#475569;word-break:keep-all;';
    addrEl.textContent = params.address;
    card.appendChild(addrEl);
  }

  if (params.meta) {
    const metaEl = document.createElement('div');
    metaEl.style.cssText =
      'margin-top:3px;font-size:11px;font-family:var(--font-mono);color:#64748B;';
    metaEl.textContent = params.meta;
    card.appendChild(metaEl);
  }

  return card;
}

export const KakaoMap: React.FC<KakaoMapProps> = ({
  centerLat,
  centerLng,
  radiusMeters,
  targetLabel,
  schools,
  stores,
  subways = [],
  busStops = [],
  hospitals = [],
  highlightedArea = null,
  onClearHighlightedArea,
  loading = false,
  onSelectCenter,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<KakaoMapInstance | null>(null);
  const mapsNsRef = useRef<KakaoMapsNamespace | null>(null);
  const circleRef = useRef<KakaoOverlay | null>(null);
  const areaPolygonRef = useRef<KakaoOverlay | null>(null);
  const areaLabelRef = useRef<KakaoOverlay | null>(null);
  const overlaysRef = useRef<KakaoOverlay[]>([]);
  const activePopupRef = useRef<KakaoOverlay | null>(null);

  const [mapConfig, setMapConfig] = useState<MapConfigResponse | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [layerMode, setLayerMode] = useState<KakaoLayerMode>('roadmap');
  const [showStores, setShowStores] = useState(true);
  const [showSchools, setShowSchools] = useState(true);
  const [showSubways, setShowSubways] = useState(true);
  const [showBusStops, setShowBusStops] = useState(true);
  const [showHospitals, setShowHospitals] = useState(true);
  const [pickMode, setPickMode] = useState(false);

  const pickModeRef = useRef(pickMode);
  pickModeRef.current = pickMode;
  const onSelectCenterRef = useRef(onSelectCenter);
  onSelectCenterRef.current = onSelectCenter;

  const latNum = Number(centerLat);
  const lngNum = Number(centerLng);
  const hasCenter =
    centerLat.trim() !== '' &&
    centerLng.trim() !== '' &&
    Number.isFinite(latNum) &&
    Number.isFinite(lngNum);

  const schoolsWithCoords = useMemo(
    () =>
      schools.filter((s) => {
        if (s.lat === null || s.lng === null) return false;
        if (!hasCenter) return true;
        return (
          getMarkerDistanceMeters(latNum, lngNum, s.lat, s.lng, s.distanceMeters) <=
          radiusMeters
        );
      }),
    [schools, hasCenter, latNum, lngNum, radiusMeters]
  );
  const storesWithCoords = useMemo(
    () =>
      stores.filter((s) => {
        if (s.lat === null || s.lng === null) return false;
        if (!hasCenter) return true;
        return (
          getMarkerDistanceMeters(latNum, lngNum, s.lat, s.lng, s.distanceMeters) <=
          radiusMeters
        );
      }),
    [stores, hasCenter, latNum, lngNum, radiusMeters]
  );
  const subwaysWithCoords = useMemo(
    () =>
      subways.filter((s) => {
        if (s.lat === null || s.lng === null) return false;
        if (!hasCenter) return true;
        return (
          getMarkerDistanceMeters(latNum, lngNum, s.lat, s.lng, s.distanceMeters) <=
          radiusMeters
        );
      }),
    [subways, hasCenter, latNum, lngNum, radiusMeters]
  );
  const busStopsWithCoords = useMemo(
    () =>
      busStops.filter((b) => {
        if (b.lat === null || b.lng === null) return false;
        if (!hasCenter) return true;
        return (
          getMarkerDistanceMeters(latNum, lngNum, b.lat, b.lng, b.distanceMeters) <=
          radiusMeters
        );
      }),
    [busStops, hasCenter, latNum, lngNum, radiusMeters]
  );
  const hospitalsWithCoords = useMemo(
    () =>
      hospitals.filter((h) => {
        if (h.lat === null || h.lng === null) return false;
        if (!hasCenter) return true;
        return (
          getMarkerDistanceMeters(latNum, lngNum, h.lat, h.lng, h.distanceMeters) <=
          Math.max(radiusMeters, 3500)
        );
      }),
    [hospitals, hasCenter, latNum, lngNum, radiusMeters]
  );

  // Load Kakao Maps config from server
  useEffect(() => {
    let cancelled = false;
    fetch('/api/map/config')
      .then((res) => res.json())
      .then((data: MapConfigResponse) => {
        if (!cancelled) setMapConfig(data);
      })
      .catch(() => {
        if (!cancelled) setMapConfig({ configured: false, jsKey: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load Kakao SDK and initialize map instance
  useEffect(() => {
    if (!mapConfig?.configured || !mapConfig.jsKey || !containerRef.current) {
      return;
    }

    let cancelled = false;
    setSdkError(null);

    loadKakaoMapsSdk(mapConfig.jsKey)
      .then((maps) => {
        if (cancelled || !containerRef.current) return;

        mapsNsRef.current = maps;
        if (!mapRef.current) {
          const initialLat = hasCenter ? latNum : 37.5172;
          const initialLng = hasCenter ? lngNum : 127.0473;
          const map = new maps.Map(containerRef.current, {
            center: new maps.LatLng(initialLat, initialLng),
            level: getKakaoLevelForRadius(radiusMeters),
          }) as KakaoMapInstance & {
            addControl?: (control: unknown, position: unknown) => void;
          };

          if (typeof map.addControl === 'function' && maps.ZoomControl) {
            map.addControl(new maps.ZoomControl(), maps.ControlPosition.RIGHT);
          }

          maps.event.addListener(map, 'click', (mouseEvent) => {
            if (activePopupRef.current) {
              activePopupRef.current.setMap(null);
              activePopupRef.current = null;
            }
            if (!pickModeRef.current || !onSelectCenterRef.current) return;
            const latLng = mouseEvent?.latLng;
            if (!latLng) return;
            onSelectCenterRef.current(
              latLng.getLat().toFixed(6),
              latLng.getLng().toFixed(6)
            );
            setPickMode(false);
          });

          mapRef.current = map;
          setTimeout(() => map.relayout(), 50);
        }

        setSdkReady(true);
      })
      .catch((err) => {
        if (!cancelled) {
          setSdkError(
            err instanceof Error ? err.message : '카카오맵 SDK 로드 실패'
          );
          setSdkReady(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapConfig]);

  // Update cursor in pick mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setCursor(pickMode ? 'crosshair' : 'grab');
  }, [pickMode, sdkReady]);

  // Update Kakao map type (일반 / 위성)
  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsNsRef.current;
    if (!map || !maps || !sdkReady) return;
    map.setMapTypeId(
      layerMode === 'satellite'
        ? maps.MapTypeId.HYBRID
        : maps.MapTypeId.ROADMAP
    );
  }, [layerMode, sdkReady]);

  // Pan and zoom when center or radius changes
  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsNsRef.current;
    if (!map || !maps || !sdkReady || !hasCenter) return;
    map.setCenter(new maps.LatLng(latNum, lngNum));
    map.setLevel(getKakaoLevelForRadius(radiusMeters), { animate: true });
  }, [hasCenter, latNum, lngNum, radiusMeters, sdkReady]);

  // Render circle and markers
  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsNsRef.current;
    if (!map || !maps || !sdkReady) return;

    if (circleRef.current) {
      circleRef.current.setMap(null);
      circleRef.current = null;
    }
    for (const overlay of overlaysRef.current) {
      overlay.setMap(null);
    }
    overlaysRef.current = [];
    if (activePopupRef.current) {
      activePopupRef.current.setMap(null);
      activePopupRef.current = null;
    }

    const openPopup = (
      position: KakaoLatLng,
      popupCfg: Omit<Parameters<typeof createPopupElement>[0], 'onClose'>
    ) => {
      if (activePopupRef.current) {
        activePopupRef.current.setMap(null);
        activePopupRef.current = null;
      }
      const popupOverlay = new maps.CustomOverlay({
        position,
        content: createPopupElement({
          ...popupCfg,
          onClose: () => {
            popupOverlay.setMap(null);
            if (activePopupRef.current === popupOverlay) {
              activePopupRef.current = null;
            }
          },
        }),
        xAnchor: 0.5,
        yAnchor: 1.18,
        zIndex: 50,
        clickable: true,
      });
      popupOverlay.setMap(map);
      activePopupRef.current = popupOverlay;
    };

    if (hasCenter) {
      const centerPos = new maps.LatLng(latNum, lngNum);
      const circle = new maps.Circle({
        center: centerPos,
        radius: radiusMeters,
        strokeWeight: 1.5,
        strokeColor: '#1D4ED8',
        strokeOpacity: 0.9,
        strokeStyle: 'shortdash',
        fillColor: '#2563EB',
        fillOpacity: 0.06,
      });
      circle.setMap(map);
      circleRef.current = circle;

      const centerPin = document.createElement('button');
      centerPin.type = 'button';
      centerPin.title = '분석 기준 위치';
      centerPin.style.cssText =
        'width:14px;height:14px;background:#0F172A;border:2px solid #FFFFFF;box-shadow:0 1px 4px rgba(0,0,0,0.4);cursor:pointer;padding:0;';
      centerPin.addEventListener('click', (e) => {
        e.stopPropagation();
        openPopup(centerPos, {
          title: '분석 기준 위치',
          address: targetLabel || undefined,
          meta: `${latNum.toFixed(5)}, ${lngNum.toFixed(5)} · 반경 ${radiusMeters.toLocaleString(
            'ko-KR'
          )}m`,
        });
      });

      const centerOverlay = new maps.CustomOverlay({
        position: centerPos,
        content: centerPin,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 25,
        clickable: true,
      });
      centerOverlay.setMap(map);
      overlaysRef.current.push(centerOverlay);
    }

    if (showStores) {
      for (const store of storesWithCoords) {
        if (store.lat === null || store.lng === null) continue;
        const pos = new maps.LatLng(store.lat, store.lng);
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.title = store.name;
        dot.style.cssText =
          'width:10px;height:10px;border-radius:9999px;background:#2563EB;border:1.5px solid #FFFFFF;box-shadow:0 1px 2px rgba(0,0,0,0.3);cursor:pointer;padding:0;';
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          openPopup(pos, {
            title: store.name,
            subtitle: [
              store.largeCategoryName,
              store.mediumCategoryName,
              store.smallCategoryName,
            ]
              .filter(Boolean)
              .join(' · '),
            subtitleColor: '#1D4ED8',
            address: store.roadAddress || store.lotAddress,
            meta: [
              store.floor ? `${store.floor}층` : '',
              store.distanceMeters !== null
                ? `${store.distanceMeters.toLocaleString('ko-KR')}m`
                : '',
            ]
              .filter(Boolean)
              .join(' · '),
          });
        });

        const overlay = new maps.CustomOverlay({
          position: pos,
          content: dot,
          xAnchor: 0.5,
          yAnchor: 0.5,
          zIndex: 10,
          clickable: true,
        });
        overlay.setMap(map);
        overlaysRef.current.push(overlay);
      }
    }

    if (showSchools) {
      for (const school of schoolsWithCoords) {
        if (school.lat === null || school.lng === null) continue;
        const pos = new maps.LatLng(school.lat, school.lng);
        const diamond = document.createElement('button');
        diamond.type = 'button';
        diamond.title = school.name;
        diamond.style.cssText =
          'width:12px;height:12px;background:#D97706;border:2px solid #FFFFFF;transform:rotate(45deg);box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:pointer;padding:0;';
        diamond.addEventListener('click', (e) => {
          e.stopPropagation();
          openPopup(pos, {
            title: school.name,
            subtitle: [school.kindName, school.foundationType, school.coedType]
              .filter(Boolean)
              .join(' · '),
            subtitleColor: '#B45309',
            address: school.address,
            meta: [
              school.studentCount !== null
                ? `학생 ${school.studentCount.toLocaleString('ko-KR')}명`
                : '',
              school.teacherCount !== null
                ? `교원 ${school.teacherCount.toLocaleString('ko-KR')}명`
                : '',
              school.distanceMeters !== null
                ? `${school.distanceMeters.toLocaleString('ko-KR')}m`
                : '',
            ]
              .filter(Boolean)
              .join(' · '),
          });
        });

        const overlay = new maps.CustomOverlay({
          position: pos,
          content: diamond,
          xAnchor: 0.5,
          yAnchor: 0.5,
          zIndex: 18,
          clickable: true,
        });
        overlay.setMap(map);
        overlaysRef.current.push(overlay);
      }
    }

    if (showSubways) {
      for (const subway of subwaysWithCoords) {
        if (subway.lat === null || subway.lng === null) continue;
        const pos = new maps.LatLng(subway.lat, subway.lng);
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.title = subway.name;
        badge.textContent = 'T';
        badge.style.cssText =
          'width:16px;height:16px;border-radius:9999px;background:#059669;border:2px solid #FFFFFF;color:#FFFFFF;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.35);cursor:pointer;padding:0;';
        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          openPopup(pos, {
            title: subway.name,
            subtitle: subway.lineOrOperator || '지하철 · 철도역',
            subtitleColor: '#047857',
            address: subway.address || undefined,
            meta:
              subway.distanceMeters !== null
                ? `기준점 거리 ${subway.distanceMeters.toLocaleString('ko-KR')}m`
                : undefined,
          });
        });

        const overlay = new maps.CustomOverlay({
          position: pos,
          content: badge,
          xAnchor: 0.5,
          yAnchor: 0.5,
          zIndex: 20,
          clickable: true,
        });
        overlay.setMap(map);
        overlaysRef.current.push(overlay);
      }
    }

    if (showBusStops) {
      for (const stop of busStopsWithCoords) {
        if (stop.lat === null || stop.lng === null) continue;
        const pos = new maps.LatLng(stop.lat, stop.lng);
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.title = stop.name;
        badge.textContent = 'B';
        badge.style.cssText =
          'width:15px;height:15px;border-radius:3px;background:#7C3AED;border:1.5px solid #FFFFFF;color:#FFFFFF;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:pointer;padding:0;';
        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          openPopup(pos, {
            title: stop.name,
            subtitle: stop.routes || '버스정류장',
            subtitleColor: '#6D28D9',
            address: stop.address || undefined,
            meta:
              stop.distanceMeters !== null
                ? `기준점 거리 ${stop.distanceMeters.toLocaleString('ko-KR')}m`
                : undefined,
          });
        });

        const overlay = new maps.CustomOverlay({
          position: pos,
          content: badge,
          xAnchor: 0.5,
          yAnchor: 0.5,
          zIndex: 16,
          clickable: true,
        });
        overlay.setMap(map);
        overlaysRef.current.push(overlay);
      }
    }

    if (showHospitals) {
      for (const hospital of hospitalsWithCoords) {
        if (hospital.lat === null || hospital.lng === null) continue;
        const pos = new maps.LatLng(hospital.lat, hospital.lng);
        const isUni = hospital.category === '대학병원';
        const markerEl = document.createElement('button');
        markerEl.type = 'button';
        markerEl.title = hospital.name;
        markerEl.textContent = '+';
        markerEl.style.cssText = `width:${isUni ? 17 : 15}px;height:${
          isUni ? 17 : 15
        }px;background:${
          isUni ? '#E11D48' : '#FB7185'
        };border:2px solid #FFFFFF;color:#FFFFFF;font-size:11px;font-weight:700;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.35);cursor:pointer;padding:0;`;
        markerEl.addEventListener('click', (e) => {
          e.stopPropagation();
          openPopup(pos, {
            title: hospital.name,
            subtitle: hospital.category,
            subtitleColor: '#BE123C',
            address: hospital.address,
            meta:
              hospital.distanceMeters !== null
                ? `기준점 거리 ${hospital.distanceMeters.toLocaleString('ko-KR')}m`
                : undefined,
          });
        });

        const overlay = new maps.CustomOverlay({
          position: pos,
          content: markerEl,
          xAnchor: 0.5,
          yAnchor: 0.5,
          zIndex: 22,
          clickable: true,
        });
        overlay.setMap(map);
        overlaysRef.current.push(overlay);
      }
    }
  }, [
    sdkReady,
    hasCenter,
    latNum,
    lngNum,
    radiusMeters,
    targetLabel,
    schoolsWithCoords,
    storesWithCoords,
    subwaysWithCoords,
    busStopsWithCoords,
    hospitalsWithCoords,
    showSchools,
    showStores,
    showSubways,
    showBusStops,
    showHospitals,
  ]);

  // Render highlighted Seoul real-time commercial/hotspot polygon
  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsNsRef.current;
    if (!map || !maps || !sdkReady) return;

    if (areaPolygonRef.current) {
      areaPolygonRef.current.setMap(null);
      areaPolygonRef.current = null;
    }
    if (areaLabelRef.current) {
      areaLabelRef.current.setMap(null);
      areaLabelRef.current = null;
    }

    if (!highlightedArea || highlightedArea.rings.length === 0) {
      return;
    }

    const polygonPaths = highlightedArea.rings.map((ring) =>
      ring.map(([lat, lng]) => new maps.LatLng(lat, lng))
    );

    const polygon = new maps.Polygon({
      path: polygonPaths.length === 1 ? polygonPaths[0] : polygonPaths,
      strokeWeight: 2.5,
      strokeColor: '#E11D48',
      strokeOpacity: 0.95,
      strokeStyle: 'solid',
      fillColor: '#F43F5E',
      fillOpacity: 0.16,
    });
    polygon.setMap(map);
    areaPolygonRef.current = polygon;

    // Calculate bounding box and centroid for label + auto-fit
    const bounds = new maps.LatLngBounds();
    let sumLat = 0;
    let sumLng = 0;
    let ptCount = 0;
    for (const ring of highlightedArea.rings) {
      for (const [lat, lng] of ring) {
        const ll = new maps.LatLng(lat, lng);
        bounds.extend(ll);
        sumLat += lat;
        sumLng += lng;
        ptCount += 1;
      }
    }

    if (ptCount > 0) {
      const centroid = new maps.LatLng(sumLat / ptCount, sumLng / ptCount);
      const labelEl = document.createElement('div');
      labelEl.style.cssText =
        'background:rgba(15,23,42,0.92);color:#FFFFFF;border:1px solid #E11D48;padding:4px 8px;font-size:11px;font-weight:600;white-space:nowrap;box-shadow:0 2px 8px rgba(15,23,42,0.28);pointer-events:auto;';
      const metaParts = [
        highlightedArea.areaCategory,
        highlightedArea.commercialLevel
          ? `상권 ${highlightedArea.commercialLevel}`
          : '',
        highlightedArea.congestLevel
          ? `인구 ${highlightedArea.congestLevel}`
          : '',
      ]
        .filter(Boolean)
        .join(' · ');
      labelEl.innerHTML = '';
      const titleSpan = document.createElement('div');
      titleSpan.textContent = highlightedArea.areaName;
      labelEl.appendChild(titleSpan);
      if (metaParts) {
        const subSpan = document.createElement('div');
        subSpan.style.cssText =
          'font-size:10px;font-weight:400;color:#FDA4AF;margin-top:1px;';
        subSpan.textContent = metaParts;
        labelEl.appendChild(subSpan);
      }

      const labelOverlay = new maps.CustomOverlay({
        position: centroid,
        content: labelEl,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 40,
        clickable: true,
      });
      labelOverlay.setMap(map);
      areaLabelRef.current = labelOverlay;

      map.setBounds(bounds, 40, 40, 40, 40);
    }

    return () => {
      if (areaPolygonRef.current) {
        areaPolygonRef.current.setMap(null);
        areaPolygonRef.current = null;
      }
      if (areaLabelRef.current) {
        areaLabelRef.current.setMap(null);
        areaLabelRef.current = null;
      }
    };
  }, [highlightedArea, sdkReady]);

  const totalMarkerCount =
    storesWithCoords.length +
    schoolsWithCoords.length +
    subwaysWithCoords.length +
    busStopsWithCoords.length +
    hospitalsWithCoords.length;

  return (
    <div className="border border-slate-200 bg-white flex flex-col">
      <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            카카오 입지 지도 (상권 · 학교 · 지하철 · 버스 · 병원)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            {targetLabel ? `${targetLabel} · ` : ''}반경{' '}
            {radiusMeters.toLocaleString('ko-KR')}m
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowStores((v) => !v)}
            className={`h-8 px-2.5 text-xs border inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              showStores
                ? 'border-blue-600 bg-blue-50 text-blue-800 font-medium'
                : 'border-slate-300 bg-white text-slate-500'
            }`}
          >
            <span className="w-2 h-2 bg-blue-600 inline-block" />
            상가
            {storesWithCoords.length > 0 && (
              <span className="font-mono tabular-nums">
                {storesWithCoords.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowSchools((v) => !v)}
            className={`h-8 px-2.5 text-xs border inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              showSchools
                ? 'border-amber-600 bg-amber-50 text-amber-900 font-medium'
                : 'border-slate-300 bg-white text-slate-500'
            }`}
          >
            <span className="w-2 h-2 bg-amber-600 inline-block rotate-45" />
            학교
            {schoolsWithCoords.length > 0 && (
              <span className="font-mono tabular-nums">
                {schoolsWithCoords.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowSubways((v) => !v)}
            className={`h-8 px-2.5 text-xs border inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              showSubways
                ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-medium'
                : 'border-slate-300 bg-white text-slate-500'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" />
            지하철역
            {subwaysWithCoords.length > 0 && (
              <span className="font-mono tabular-nums">
                {subwaysWithCoords.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowBusStops((v) => !v)}
            className={`h-8 px-2.5 text-xs border inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              showBusStops
                ? 'border-violet-600 bg-violet-50 text-violet-900 font-medium'
                : 'border-slate-300 bg-white text-slate-500'
            }`}
          >
            <span className="w-2 h-2 rounded-xs bg-violet-600 inline-block" />
            버스정류장
            {busStopsWithCoords.length > 0 && (
              <span className="font-mono tabular-nums">
                {busStopsWithCoords.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowHospitals((v) => !v)}
            className={`h-8 px-2.5 text-xs border inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              showHospitals
                ? 'border-rose-600 bg-rose-50 text-rose-900 font-medium'
                : 'border-slate-300 bg-white text-slate-500'
            }`}
          >
            <span className="w-2 h-2 bg-rose-600 inline-block" />
            대학병원
            {hospitalsWithCoords.length > 0 && (
              <span className="font-mono tabular-nums">
                {hospitalsWithCoords.length}
              </span>
            )}
          </button>

          {onSelectCenter && (
            <button
              type="button"
              onClick={() => setPickMode((v) => !v)}
              className={`h-8 px-2.5 text-xs border inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                pickMode
                  ? 'border-slate-900 bg-slate-900 text-white font-medium'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              {pickMode ? '지도 클릭 대기 중' : '기준점 지정'}
            </button>
          )}

          {/* Kakao map type switcher (일반 / 위성) */}
          <div className="inline-flex items-center border border-slate-300 bg-white p-0.5">
            <Layers className="w-3.5 h-3.5 text-slate-400 mx-1.5 shrink-0" />
            {(
              [
                { id: 'roadmap', label: '일반' },
                { id: 'satellite', label: '위성' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setLayerMode(opt.id)}
                className={`px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  layerMode === opt.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative h-[420px] w-full bg-slate-50">
        <div ref={containerRef} className="w-full h-full" />
        {highlightedArea && (
          <div className="absolute top-3 left-3 z-10 flex items-center gap-2 bg-white/95 border border-rose-300 px-3 py-1.5 text-xs text-slate-900 shadow-sm">
            <span className="w-2.5 h-2.5 bg-rose-500/30 border border-rose-600 inline-block shrink-0" />
            <span className="font-semibold">{highlightedArea.areaName}</span>
            {highlightedArea.areaCategory && (
              <span className="text-[11px] text-rose-700">
                {highlightedArea.areaCategory}
              </span>
            )}
            {onClearHighlightedArea && (
              <button
                type="button"
                onClick={onClearHighlightedArea}
                className="ml-1 text-slate-400 hover:text-slate-900 font-semibold cursor-pointer"
                title="상권 구역 표시 해제"
              >
                ×
              </button>
            )}
          </div>
        )}
        {loading && (
          <div className="pointer-events-none absolute top-3 right-3 z-10 bg-white/95 border border-slate-200 px-3 py-1.5 text-xs text-slate-700">
            위치 데이터 불러오는 중...
          </div>
        )}
        {sdkError && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50/95 p-6 text-center">
            <div className="max-w-md border border-slate-200 bg-white px-5 py-4 text-xs text-slate-600 space-y-1">
              <div className="font-semibold text-slate-900">
                카카오맵을 불러올 수 없습니다
              </div>
              <div>{sdkError}</div>
            </div>
          </div>
        )}
      </div>

      <div className="px-5 py-2.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          {mapConfig && !mapConfig.configured
            ? 'KAKAO_JAVASCRIPT_API_KEY가 미설정되어 지도를 표시할 수 없습니다'
            : sdkError
              ? sdkError
              : '상가·학교·지하철역·버스정류장은 설정 반경 내, 대학·종합병원은 3.5km 내 항목이 표시됩니다'}
        </span>
        <span className="font-mono tabular-nums">
          {totalMarkerCount > 0
            ? `상가 ${storesWithCoords.length} · 학교 ${schoolsWithCoords.length} · 지하철 ${subwaysWithCoords.length} · 버스 ${busStopsWithCoords.length} · 병원 ${hospitalsWithCoords.length}`
            : '\u00A0'}
        </span>
      </div>
    </div>
  );
};
