import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Building2,
  Compass,
  Download,
  FileCode2,
  GraduationCap,
  Menu,
  Store,
  X,
} from 'lucide-react';
import { ApiSpecsView } from './components/ApiSpecsView.tsx';
import { CommercialView } from './components/CommercialView.tsx';
import { OverviewView } from './components/OverviewView.tsx';
import { QueryControlBar } from './components/QueryControlBar.tsx';
import { RebView } from './components/RebView.tsx';
import { SchoolsView } from './components/SchoolsView.tsx';
import { TransactionsView } from './components/TransactionsView.tsx';
import type {
  AnalysisResponse,
  AnalysisTab,
  ApiSourceSpec,
  LocationQueryParams,
  PropertyType,
  RegionOptionsResponse,
} from './types/analysis.ts';

interface NavItem {
  id: AnalysisTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: '입지 종합 분석', icon: Compass },
  { id: 'schools', label: '학교알리미 · 학군', icon: GraduationCap },
  { id: 'commercial', label: '공공상가 · 상권', icon: Store },
  { id: 'transactions', label: '실거래가 · 시세', icon: Building2 },
  { id: 'reb', label: '한국부동산원 · 지표', icon: BarChart3 },
  { id: 'specs', label: 'API 연동 규격', icon: FileCode2 },
];

const INITIAL_PARAMS: LocationQueryParams = {
  sidoCode: '11',
  sggCode: '11680',
  dongCode: '',
  dongName: '',
  complexName: '',
  lat: '37.5172',
  lng: '127.0473',
  radius: 500,
  dealYmd: '202610',
  propertyType: 'apt',
  schulKndCode: '',
  manualCoords: false,
};

function escapeCsvCell(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AnalysisTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [params, setParams] = useState<LocationQueryParams>(INITIAL_PARAMS);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [sources, setSources] = useState<ApiSourceSpec[]>([]);
  const [regionOptions, setRegionOptions] = useState<RegionOptionsResponse>({
    dongs: [],
    complexes: [],
  });
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const fetchSources = useCallback(async () => {
    setLoadingSources(true);
    try {
      const res = await fetch('/api/sources');
      if (!res.ok) throw new Error('소스 상태 조회 실패');
      const data = (await res.json()) as { sources: ApiSourceSpec[] };
      setSources(data.sources ?? []);
    } catch {
      setSources([]);
    } finally {
      setLoadingSources(false);
    }
  }, []);

  const fetchRegionOptions = useCallback(
    async (sidoCode: string, sggCode: string, dealYmd: string) => {
      if (!sggCode || sggCode.length < 5) return;
      setLoadingOptions(true);
      try {
        const search = new URLSearchParams({ sidoCode, sggCode, dealYmd });
        const res = await fetch(`/api/region/options?${search.toString()}`);
        if (!res.ok) throw new Error('동/단지 목록 조회 실패');
        const data = (await res.json()) as RegionOptionsResponse;
        setRegionOptions(data);
      } catch {
        setRegionOptions({ dongs: [], complexes: [] });
      } finally {
        setLoadingOptions(false);
      }
    },
    []
  );

  const executeAnalysis = useCallback(
    async (overrideParams?: LocationQueryParams) => {
      const target = overrideParams ?? params;
      setLoadingAnalysis(true);
      setRequestError(null);
      try {
        const search = new URLSearchParams({
          sidoCode: target.sidoCode,
          sggCode: target.sggCode,
          dongCode: target.dongCode,
          dongName: target.dongName,
          complexName: target.complexName,
          lat: target.lat,
          lng: target.lng,
          radius: String(target.radius),
          dealYmd: target.dealYmd,
          propertyType: target.propertyType,
          schulKndCode: target.schulKndCode,
          manualCoords: target.manualCoords ? 'true' : 'false',
        });
        const res = await fetch(`/api/analysis?${search.toString()}`);
        if (!res.ok) {
          throw new Error(`분석 요청 오류 (${res.status})`);
        }
        const data = (await res.json()) as AnalysisResponse;
        setAnalysis(data);
        setParams((prev) => ({
          ...prev,
          sidoCode: data.params.sidoCode || prev.sidoCode,
          sggCode: data.params.sggCode || prev.sggCode,
          lat: data.params.lat || prev.lat,
          lng: data.params.lng || prev.lng,
        }));
      } catch (err) {
        setRequestError(
          err instanceof Error ? err.message : '입지 분석 데이터 조회 실패'
        );
      } finally {
        setLoadingAnalysis(false);
      }
    },
    [params]
  );

  useEffect(() => {
    void fetchSources();
    void executeAnalysis(INITIAL_PARAMS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void fetchRegionOptions(params.sidoCode, params.sggCode, params.dealYmd);
  }, [params.sidoCode, params.sggCode, params.dealYmd, fetchRegionOptions]);

  const handlePropertyTypeChange = (nextType: PropertyType) => {
    const bothApt =
      (params.propertyType === 'apt' || params.propertyType === 'aptRent') &&
      (nextType === 'apt' || nextType === 'aptRent');
    const bothOffi =
      (params.propertyType === 'officetel' ||
        params.propertyType === 'officetelRent') &&
      (nextType === 'officetel' || nextType === 'officetelRent');
    const keepComplex = bothApt || bothOffi;

    const nextParams: LocationQueryParams = {
      ...params,
      propertyType: nextType,
      complexName: keepComplex ? params.complexName : '',
      manualCoords: keepComplex ? params.manualCoords : false,
    };
    setParams(nextParams);
    void executeAnalysis(nextParams);
  };

  const handleSelectCenter = (lat: string, lng: string) => {
    const nextParams: LocationQueryParams = {
      ...params,
      lat,
      lng,
      manualCoords: true,
    };
    setParams(nextParams);
    void executeAnalysis(nextParams);
  };

  const activeNavLabel =
    NAV_ITEMS.find((item) => item.id === activeTab)?.label ?? '입지 종합 분석';

  const hasExportableData = Boolean(
    analysis &&
      ((activeTab === 'schools' && analysis.schools.items.length > 0) ||
        (activeTab === 'commercial' && analysis.commercial.items.length > 0) ||
        (activeTab === 'transactions' &&
          analysis.transactions.items.length > 0) ||
        (activeTab === 'reb' && analysis.reb.items.length > 0) ||
        (activeTab === 'overview' &&
          (analysis.schools.items.length > 0 ||
            analysis.commercial.items.length > 0 ||
            analysis.transactions.items.length > 0 ||
            analysis.reb.items.length > 0)))
  );

  const handleExportCsv = () => {
    if (!analysis || !hasExportableData) return;

    let headers: string[] = [];
    let rows: (string | number | null)[][] = [];
    let filename = `location-analysis-${params.sggCode}.csv`;

    if (activeTab === 'schools') {
      headers = ['학교명', '학교급', '설립구분', '남녀공학', '학생수', '교원수', '거리(m)', '주소'];
      rows = analysis.schools.items.map((s) => [
        s.name,
        s.kindName,
        s.foundationType,
        s.coedType,
        s.studentCount,
        s.teacherCount,
        s.distanceMeters,
        s.address,
      ]);
      filename = `schools-${params.sggCode}.csv`;
    } else if (activeTab === 'transactions') {
      if (
        params.propertyType === 'aptRent' ||
        params.propertyType === 'officetelRent' ||
        params.propertyType === 'rowhouseRent' ||
        params.propertyType === 'detachedRent'
      ) {
        headers = [
          params.propertyType === 'detachedRent'
            ? '주택유형'
            : params.propertyType === 'rowhouseRent'
              ? '건물명'
              : params.propertyType === 'officetelRent'
                ? '오피스텔명'
                : '단지명',
          '법정동',
          '지번',
          '계약구분',
          params.propertyType === 'detachedRent'
            ? '계약면적(㎡)'
            : '전용면적(㎡)',
          '보증금(만원)',
          '월세(만원)',
          '층',
          '건축년도',
          '계약일',
        ];
        rows = analysis.transactions.items.map((t) => [
          t.propertyName,
          t.dongName,
          t.jibun,
          t.contractType || t.buildingUse,
          t.areaSqm,
          t.priceMan,
          t.monthlyRentMan,
          t.floor,
          t.buildYear,
          t.dealDate,
        ]);
      } else if (params.propertyType === 'detached') {
        headers = [
          '주택유형',
          '법정동',
          '지번',
          '연면적(㎡)',
          '대지면적(㎡)',
          '거래금액(만원)',
          '단가(만원/㎡)',
          '건축년도',
          '계약일',
        ];
        rows = analysis.transactions.items.map((t) => [
          t.propertyName,
          t.dongName,
          t.jibun,
          t.areaSqm,
          t.plottageAreaSqm,
          t.priceMan,
          t.pricePerSqmMan,
          t.buildYear,
          t.dealDate,
        ]);
      } else if (params.propertyType === 'land') {
        headers = [
          '지목·용도',
          '법정동',
          '지번',
          '지목',
          '용도지역',
          '거래면적(㎡)',
          '거래금액(만원)',
          '단가(만원/㎡)',
          '계약일',
        ];
        rows = analysis.transactions.items.map((t) => [
          t.propertyName,
          t.dongName,
          t.jibun,
          t.jimok,
          t.landUse,
          t.areaSqm,
          t.priceMan,
          t.pricePerSqmMan,
          t.dealDate,
        ]);
      } else if (params.propertyType === 'commercial') {
        headers = [
          '건물용도·유형',
          '법정동',
          '지번',
          '용도지역',
          '건물면적(㎡)',
          '대지면적(㎡)',
          '거래금액(만원)',
          '단가(만원/㎡)',
          '건축년도',
          '계약일',
        ];
        rows = analysis.transactions.items.map((t) => [
          t.propertyName,
          t.dongName,
          t.jibun,
          t.landUse,
          t.areaSqm,
          t.plottageAreaSqm,
          t.priceMan,
          t.pricePerSqmMan,
          t.buildYear,
          t.dealDate,
        ]);
      } else {
        headers = [
          '단지건물명',
          '법정동',
          '지번',
          '유형',
          '전용면적(㎡)',
          '거래금액(만원)',
          '단가(만원/㎡)',
          '층',
          '건축년도',
          '계약일',
        ];
        rows = analysis.transactions.items.map((t) => [
          t.propertyName,
          t.dongName,
          t.jibun,
          t.buildingUse,
          t.areaSqm,
          t.priceMan,
          t.pricePerSqmMan,
          t.floor,
          t.buildYear,
          t.dealDate,
        ]);
      }
      filename = `transactions-${params.propertyType}-${params.sggCode}-${params.dealYmd}.csv`;
    } else if (activeTab === 'reb') {
      headers = ['통계표명', '지역구분', '항목', '기준시점', '수치', '단위'];
      rows = analysis.reb.items.map((r) => [
        r.statTableName,
        r.regionFullName,
        r.itemName,
        r.periodLabel,
        r.value,
        r.unit,
      ]);
      filename = `reb-stats-${params.sggCode}.csv`;
    } else if (activeTab === 'commercial' || analysis.commercial.items.length > 0) {
      headers = [
        '상호명',
        '대분류',
        '중분류',
        '소분류',
        '층',
        '거리(m)',
        '도로명주소',
        '위도',
        '경도',
      ];
      rows = analysis.commercial.items.map((c) => [
        c.name,
        c.largeCategoryName,
        c.mediumCategoryName,
        c.smallCategoryName,
        c.floor,
        c.distanceMeters,
        c.roadAddress || c.lotAddress,
        c.lat,
        c.lng,
      ]);
      filename = `commercial-${params.sggCode}-${params.radius}m.csv`;
    } else {
      headers = [
        '단지건물명',
        '법정동',
        '전용면적(㎡)',
        '거래금액(만원)',
        '단가(만원/㎡)',
        '계약일',
      ];
      rows = analysis.transactions.items.map((t) => [
        t.propertyName,
        t.dongName,
        t.areaSqm,
        t.priceMan,
        t.pricePerSqmMan,
        t.dealDate,
      ]);
      filename = `overview-transactions-${params.sggCode}-${params.dealYmd}.csv`;
    }

    const csvContent =
      '\uFEFF' +
      [headers, ...rows]
        .map((row) => row.map(escapeCsvCell).join(','))
        .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-white border-r border-slate-200 shrink-0">
        <div className="h-14 px-5 border-b border-slate-200 flex items-center">
          <span className="text-base font-bold tracking-tight text-slate-900 font-display whitespace-nowrap">
            지오사이트
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1" aria-label="분석 메뉴">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-2.5">
          <div className="text-[11px] font-semibold text-slate-500">
            데이터 소스 연결
          </div>
          <div className="space-y-1.5">
            {sources.map((src) => (
              <div
                key={src.id}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="text-slate-600 truncate">{src.name}</span>
                <span
                  className={`shrink-0 text-[11px] ${
                    src.configured
                      ? 'text-emerald-700 font-medium'
                      : 'text-slate-400'
                  }`}
                >
                  {src.configured ? '연결됨' : '미연결'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-50 w-64 max-w-xs bg-white border-r border-slate-200 flex flex-col">
            <div className="h-14 px-5 border-b border-slate-200 flex items-center justify-between">
              <span className="text-base font-bold tracking-tight text-slate-900 font-display">
                지오사이트
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="메뉴 닫기"
                className="p-1.5 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="메뉴 열기"
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-xs min-w-0">
              <span className="text-slate-400 whitespace-nowrap shrink-0">
                부동산 입지 분석
              </span>
              <span className="text-slate-300" aria-hidden="true">
                /
              </span>
              <h1 className="font-semibold text-slate-900 truncate">
                {activeNavLabel}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!hasExportableData}
              className="h-9 px-3.5 text-xs font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              CSV 내보내기
            </button>
          </div>
        </header>

        {activeTab !== 'specs' && (
          <QueryControlBar
            params={params}
            regionOptions={regionOptions}
            loadingOptions={loadingOptions}
            resolvedLocation={analysis?.resolvedLocation ?? null}
            onChange={setParams}
            onExecute={(override) => void executeAnalysis(override)}
            loading={loadingAnalysis}
          />
        )}

        <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto">
          {requestError && (
            <div className="mb-6 border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
              {requestError}
            </div>
          )}

          {activeTab === 'overview' && (
            <OverviewView
              analysis={analysis}
              params={params}
              loading={loadingAnalysis}
              onSelectCenter={handleSelectCenter}
            />
          )}

          {activeTab === 'schools' && (
            <SchoolsView
              dataset={analysis?.schools ?? null}
              loading={loadingAnalysis}
            />
          )}

          {activeTab === 'commercial' && (
            <CommercialView
              dataset={analysis?.commercial ?? null}
              radius={params.radius}
              loading={loadingAnalysis}
            />
          )}

          {activeTab === 'transactions' && (
            <TransactionsView
              dataset={analysis?.transactions ?? null}
              buildingRegister={analysis?.buildingRegister ?? null}
              dongName={analysis?.resolvedLocation?.dongName}
              propertyType={params.propertyType}
              onPropertyTypeChange={handlePropertyTypeChange}
              loading={loadingAnalysis}
            />
          )}

          {activeTab === 'reb' && (
            <RebView
              dataset={analysis?.reb ?? null}
              loading={loadingAnalysis}
            />
          )}

          {activeTab === 'specs' && (
            <ApiSpecsView sources={sources} loading={loadingSources} />
          )}
        </main>
      </div>
    </div>
  );
}
