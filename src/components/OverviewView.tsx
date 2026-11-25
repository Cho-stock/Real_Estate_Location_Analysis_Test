import React, { useEffect, useState } from 'react';
import { BuildingRegisterPanel } from './BuildingRegisterPanel.tsx';
import { DataTable, type TableColumn } from './DataTable.tsx';
import { DistributionPanel } from './DistributionPanel.tsx';
import { MetricGrid, type MetricItem } from './MetricGrid.tsx';
import { KakaoMap, type HighlightedCommercialArea } from './KakaoMap.tsx';
import { SeoulCityDataPanel } from './SeoulCityDataPanel.tsx';
import type {
  AnalysisResponse,
  HospitalRecord,
  LocationQueryParams,
  SchoolRecord,
  SeoulCityDataSummary,
  SubwayStationRecord,
  TransactionRecord,
} from '../types/analysis.ts';

interface OverviewViewProps {
  analysis: AnalysisResponse | null;
  params: LocationQueryParams;
  loading: boolean;
  onSelectCenter?: (lat: string, lng: string) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  analysis,
  params,
  loading,
  onSelectCenter,
}) => {
  const [highlightedArea, setHighlightedArea] =
    useState<HighlightedCommercialArea | null>(null);

  useEffect(() => {
    setHighlightedArea(null);
  }, [analysis?.queriedAt]);

  const handleShowAreaOnMap = (summary: SeoulCityDataSummary | null) => {
    if (!summary || !summary.areaPolygon || summary.areaPolygon.length === 0) {
      setHighlightedArea(null);
      return;
    }
    setHighlightedArea({
      areaCode: summary.areaCode,
      areaName: summary.areaName,
      areaCategory: summary.areaCategory,
      congestLevel: summary.congestLevel,
      commercialLevel: summary.commercialLevel,
      rings: summary.areaPolygon,
    });
  };

  const commercial = analysis?.commercial;
  const schools = analysis?.schools;
  const subways = analysis?.subways ?? [];
  const busStops = analysis?.busStops ?? [];
  const hospitals = analysis?.hospitals ?? [];
  const transactions = analysis?.transactions;
  const reb = analysis?.reb;

  const kpiItems: MetricItem[] = [
    {
      id: 'stores-total',
      label: '상가 업소 수',
      unit: '개소',
      value: commercial?.summary ? commercial.summary.totalStores : null,
      subtext: commercial?.summary?.topCategoryName
        ? `최다 업종: ${commercial.summary.topCategoryName}`
        : null,
    },
    {
      id: 'store-density',
      label: '상권 밀집도',
      unit: '개/km²',
      value:
        commercial?.summary?.densityPerSqKm !== null &&
        commercial?.summary?.densityPerSqKm !== undefined
          ? commercial.summary.densityPerSqKm
          : null,
      subtext: commercial?.summary ? `반경 ${params.radius}m 기준` : null,
    },
    {
      id: 'schools-total',
      label: '관할 학교 수',
      unit: '개교',
      value: schools?.summary ? schools.summary.totalSchools : null,
      subtext: schools?.summary
        ? `초 ${schools.summary.elementaryCount} · 중 ${schools.summary.middleCount} · 고 ${schools.summary.highCount}`
        : null,
    },
    params.propertyType === 'aptRent' ||
    params.propertyType === 'officetelRent' ||
    params.propertyType === 'rowhouseRent' ||
    params.propertyType === 'detachedRent'
      ? {
          id: 'tx-avg-price',
          label: '평균 보증금',
          unit: '만원',
          value:
            transactions?.summary?.avgPriceMan !== null &&
            transactions?.summary?.avgPriceMan !== undefined
              ? transactions.summary.avgPriceMan
              : null,
          subtext: transactions?.summary
            ? `${transactions.summary.totalTransactions.toLocaleString('ko-KR')}건 전월세 기준`
            : null,
        }
      : {
          id: 'tx-avg-price',
          label: '평균 실거래가',
          unit: '만원',
          value:
            transactions?.summary?.avgPriceMan !== null &&
            transactions?.summary?.avgPriceMan !== undefined
              ? transactions.summary.avgPriceMan
              : null,
          subtext: transactions?.summary
            ? `${transactions.summary.totalTransactions.toLocaleString('ko-KR')}건 거래 기준`
            : null,
        },
    params.propertyType === 'aptRent' ||
    params.propertyType === 'officetelRent' ||
    params.propertyType === 'rowhouseRent' ||
    params.propertyType === 'detachedRent'
      ? {
          id: 'tx-unit-price',
          label: '평균 월세',
          unit: '만원',
          value:
            transactions?.summary?.avgMonthlyRentMan !== null &&
            transactions?.summary?.avgMonthlyRentMan !== undefined
              ? transactions.summary.avgMonthlyRentMan
              : null,
          subtext:
            transactions?.summary?.avgAreaSqm !== null &&
            transactions?.summary?.avgAreaSqm !== undefined
              ? `평균 면적 ${transactions.summary.avgAreaSqm}㎡`
              : null,
        }
      : {
          id: 'tx-unit-price',
          label: '㎡당 평균 단가',
          unit: '만원/㎡',
          value:
            transactions?.summary?.avgPricePerSqmMan !== null &&
            transactions?.summary?.avgPricePerSqmMan !== undefined
              ? transactions.summary.avgPricePerSqmMan
              : null,
          subtext:
            transactions?.summary?.avgAreaSqm !== null &&
            transactions?.summary?.avgAreaSqm !== undefined
              ? `평균 면적 ${transactions.summary.avgAreaSqm}㎡`
              : null,
        },
    {
      id: 'reb-land-rate',
      label: '지역 지가변동률',
      unit: '%',
      value:
        reb?.summary?.landChangeRate !== null &&
        reb?.summary?.landChangeRate !== undefined
          ? Number(reb.summary.landChangeRate.toFixed(3))
          : null,
      subtext:
        reb?.summary?.matchedRegionLabel && reb?.summary?.landChangeRatePeriod
          ? `${reb.summary.matchedRegionLabel} · ${reb.summary.landChangeRatePeriod}`
          : null,
    },
  ];

  const categoryRows = (commercial?.summary?.categoryDistribution ?? [])
    .slice(0, 6)
    .map((c) => ({
      label: c.categoryName,
      count: c.count,
      ratio: c.ratio,
    }));

  const schoolKindRows = (schools?.summary?.kindDistribution ?? []).map(
    (k) => ({
      label: k.kindName,
      count: k.count,
      ratio: k.ratio,
    })
  );

  const schoolColumns: TableColumn<SchoolRecord>[] = [
    { key: 'name', header: '학교명', render: (r) => r.name },
    { key: 'kind', header: '학교급', render: (r) => r.kindName },
    { key: 'fond', header: '설립', render: (r) => r.foundationType },
    {
      key: 'dist',
      header: '거리 (m)',
      align: 'right',
      render: (r) =>
        r.distanceMeters !== null ? r.distanceMeters.toLocaleString('ko-KR') : '',
    },
    { key: 'address', header: '주소', render: (r) => r.address },
  ];

  const subwayColumns: TableColumn<SubwayStationRecord>[] = [
    { key: 'name', header: '역명', render: (r) => r.name },
    { key: 'line', header: '노선 · 운영', render: (r) => r.lineOrOperator },
    {
      key: 'dist',
      header: '거리 (m)',
      align: 'right',
      render: (r) =>
        r.distanceMeters !== null ? r.distanceMeters.toLocaleString('ko-KR') : '',
    },
    { key: 'address', header: '주소', render: (r) => r.address },
  ];

  const hospitalColumns: TableColumn<HospitalRecord>[] = [
    { key: 'name', header: '병원명', render: (r) => r.name },
    { key: 'category', header: '구분', render: (r) => r.category },
    {
      key: 'dist',
      header: '거리 (m)',
      align: 'right',
      render: (r) =>
        r.distanceMeters !== null ? r.distanceMeters.toLocaleString('ko-KR') : '',
    },
    { key: 'address', header: '주소', render: (r) => r.address },
  ];

  const txColumns: TableColumn<TransactionRecord>[] =
    params.propertyType === 'aptRent' ||
    params.propertyType === 'officetelRent' ||
    params.propertyType === 'rowhouseRent' ||
    params.propertyType === 'detachedRent'
      ? [
          {
            key: 'name',
            header:
              params.propertyType === 'detachedRent'
                ? '주택유형'
                : params.propertyType === 'rowhouseRent'
                  ? '건물명'
                  : params.propertyType === 'officetelRent'
                    ? '오피스텔명'
                    : '단지명',
            render: (r) => r.propertyName,
          },
          { key: 'dong', header: '법정동', render: (r) => r.dongName },
          {
            key: 'area',
            header: params.propertyType === 'detachedRent' ? '계약 (㎡)' : '전용 (㎡)',
            align: 'right',
            render: (r) => (r.areaSqm !== null ? r.areaSqm.toFixed(1) : ''),
          },
          {
            key: 'price',
            header: '보증/월세 (만원)',
            align: 'right',
            render: (r) =>
              r.priceMan !== null
                ? `${r.priceMan.toLocaleString('ko-KR')} / ${
                    r.monthlyRentMan !== null
                      ? r.monthlyRentMan.toLocaleString('ko-KR')
                      : '0'
                  }`
                : '',
          },
          { key: 'date', header: '계약일', align: 'right', render: (r) => r.dealDate },
        ]
      : params.propertyType === 'land'
        ? [
            { key: 'name', header: '지목 · 용도', render: (r) => r.propertyName },
            { key: 'dong', header: '법정동', render: (r) => r.dongName },
            {
              key: 'area',
              header: '거래면적 (㎡)',
              align: 'right',
              render: (r) => (r.areaSqm !== null ? r.areaSqm.toFixed(1) : ''),
            },
            {
              key: 'price',
              header: '거래금액 (만원)',
              align: 'right',
              render: (r) =>
                r.priceMan !== null ? r.priceMan.toLocaleString('ko-KR') : '',
            },
            { key: 'date', header: '계약일', align: 'right', render: (r) => r.dealDate },
          ]
        : [
            {
              key: 'name',
              header:
                params.propertyType === 'commercial'
                  ? '건물용도·유형'
                  : params.propertyType === 'detached'
                    ? '주택유형'
                    : '단지·건물명',
              render: (r) => r.propertyName,
            },
            { key: 'dong', header: '법정동', render: (r) => r.dongName },
            {
              key: 'area',
              header:
                params.propertyType === 'commercial'
                  ? '건물면적 (㎡)'
                  : params.propertyType === 'detached'
                    ? '연면적 (㎡)'
                    : '전용면적 (㎡)',
              align: 'right',
              render: (r) => (r.areaSqm !== null ? r.areaSqm.toFixed(1) : ''),
            },
            {
              key: 'price',
              header: '거래금액 (만원)',
              align: 'right',
              render: (r) =>
                r.priceMan !== null ? r.priceMan.toLocaleString('ko-KR') : '',
            },
            { key: 'date', header: '계약일', align: 'right', render: (r) => r.dealDate },
          ];

  const emptyOrErrorSources: string[] = [];
  if (analysis) {
    if (!analysis.schools.configured || analysis.schools.error) {
      emptyOrErrorSources.push(
        analysis.schools.error
          ? `학교알리미(${analysis.schools.error})`
          : '학교알리미(미연결)'
      );
    }
    if (!analysis.commercial.configured || analysis.commercial.error) {
      emptyOrErrorSources.push(
        analysis.commercial.error
          ? `공공상가정보(${analysis.commercial.error})`
          : '공공상가정보(미연결)'
      );
    }
    if (!analysis.transactions.configured || analysis.transactions.error) {
      emptyOrErrorSources.push(
        analysis.transactions.error
          ? `실거래가(${analysis.transactions.error})`
          : '실거래가(미연결)'
      );
    }
    if (!analysis.reb.configured || analysis.reb.error) {
      emptyOrErrorSources.push(
        analysis.reb.error
          ? `한국부동산원(${analysis.reb.error})`
          : '한국부동산원(미연결)'
      );
    }
  }

  return (
    <div className="space-y-6">
      {analysis && emptyOrErrorSources.length > 0 && (
        <div className="border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span>
            데이터 미수신 항목({emptyOrErrorSources.join(' · ')})은 목업 없이
            빈칸으로 유지됩니다.
          </span>
          <span className="text-slate-400 shrink-0">
            API 연동 규격 탭에서 상세 확인
          </span>
        </div>
      )}

      <MetricGrid items={kpiItems} columns={6} loading={loading} />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        <div className="xl:col-span-7 flex flex-col">
          <KakaoMap
            centerLat={params.lat}
            centerLng={params.lng}
            radiusMeters={params.radius}
            targetLabel={analysis?.resolvedLocation?.label}
            schools={schools?.items ?? []}
            stores={commercial?.items ?? []}
            subways={subways}
            busStops={busStops}
            hospitals={hospitals}
            highlightedArea={highlightedArea}
            onClearHighlightedArea={() => setHighlightedArea(null)}
            loading={loading}
            onSelectCenter={onSelectCenter}
          />
        </div>

        <div className="xl:col-span-5 flex flex-col gap-6">
          <DistributionPanel
            title="상권 업종 대분류 분포"
            subtitle="소상공인시장진흥공단 반경·행정동 상가업소 집계"
            rows={categoryRows}
            emptySlotCount={6}
            barColorClass="bg-blue-600"
            loading={loading}
          />
          <DistributionPanel
            title="관할 학군 학교급 구성"
            subtitle="학교알리미 공시 기준 초·중·고 분포"
            rows={schoolKindRows}
            emptySlotCount={3}
            barColorClass="bg-amber-600"
            loading={loading}
          />
        </div>
      </div>

      <SeoulCityDataPanel
        data={analysis?.seoulCityData ?? null}
        centerLat={params.lat}
        centerLng={params.lng}
        loading={loading}
        activeMapAreaCode={highlightedArea?.areaCode ?? null}
        onShowAreaOnMap={handleShowAreaOnMap}
      />

      <BuildingRegisterPanel
        data={analysis?.buildingRegister ?? null}
        dongName={analysis?.resolvedLocation?.dongName}
        loading={loading}
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              인근 학교 주요 목록
            </h3>
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              {schools?.items.length
                ? `총 ${schools.items.length}개교 중 상위 5건`
                : '\u00A0'}
            </span>
          </div>
          <DataTable
            columns={schoolColumns}
            rows={(schools?.items ?? []).slice(0, 5)}
            rowKey={(r) => r.id}
            emptyRows={5}
            loading={loading}
          />
        </div>

        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              최근 실거래 내역
            </h3>
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              {transactions?.items.length
                ? `총 ${transactions.items.length}건 중 상위 5건`
                : '\u00A0'}
            </span>
          </div>
          <DataTable
            columns={txColumns}
            rows={(transactions?.items ?? []).slice(0, 5)}
            rowKey={(r) => r.id}
            emptyRows={5}
            loading={loading}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              인근 지하철역
            </h3>
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              {subways.length
                ? `총 ${subways.length}개역 중 상위 5건`
                : '\u00A0'}
            </span>
          </div>
          <DataTable
            columns={subwayColumns}
            rows={subways.slice(0, 5)}
            rowKey={(r) => r.id}
            emptyRows={5}
            loading={loading}
          />
        </div>

        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              인근 대학 · 종합병원
            </h3>
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              {hospitals.length
                ? `총 ${hospitals.length}개소 중 상위 5건`
                : '\u00A0'}
            </span>
          </div>
          <DataTable
            columns={hospitalColumns}
            rows={hospitals.slice(0, 5)}
            rowKey={(r) => r.id}
            emptyRows={5}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
};
