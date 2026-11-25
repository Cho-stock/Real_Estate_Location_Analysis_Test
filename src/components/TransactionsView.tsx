import React, { useMemo, useState } from 'react';
import type {
  BuildingRegisterResult,
  DatasetResult,
  PropertyType,
  TransactionRecord,
  TransactionSummary,
} from '../types/analysis.ts';
import { BuildingRegisterPanel } from './BuildingRegisterPanel.tsx';
import { DataTable, type TableColumn } from './DataTable.tsx';
import { MetricGrid, type MetricItem } from './MetricGrid.tsx';

interface TransactionsViewProps {
  dataset: DatasetResult<TransactionRecord, TransactionSummary> | null;
  buildingRegister?: BuildingRegisterResult | null;
  dongName?: string;
  propertyType: PropertyType;
  onPropertyTypeChange: (next: PropertyType) => void;
  loading: boolean;
}

const PROPERTY_TABS: { id: PropertyType; label: string }[] = [
  { id: 'apt', label: '아파트 매매' },
  { id: 'aptRent', label: '아파트 전월세' },
  { id: 'officetel', label: '오피스텔 매매' },
  { id: 'officetelRent', label: '오피스텔 전월세' },
  { id: 'rowhouse', label: '연립·다세대 매매' },
  { id: 'rowhouseRent', label: '연립·다세대 전월세' },
  { id: 'detached', label: '단독·다가구 매매' },
  { id: 'detachedRent', label: '단독·다가구 전월세' },
  { id: 'commercial', label: '상업·업무용 매매' },
  { id: 'land', label: '토지 매매' },
];

export const TransactionsView: React.FC<TransactionsViewProps> = ({
  dataset,
  buildingRegister = null,
  dongName,
  propertyType,
  onPropertyTypeChange,
  loading,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const summary = dataset?.summary ?? null;
  const items = dataset?.items ?? [];

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.propertyName.toLowerCase().includes(q) ||
        item.dongName.toLowerCase().includes(q) ||
        item.buildingUse.toLowerCase().includes(q) ||
        item.jimok.toLowerCase().includes(q) ||
        item.landUse.toLowerCase().includes(q) ||
        item.jibun.toLowerCase().includes(q)
    );
  }, [items, searchTerm]);

  const isRent =
    propertyType === 'aptRent' ||
    propertyType === 'officetelRent' ||
    propertyType === 'rowhouseRent' ||
    propertyType === 'detachedRent';
  const isLand = propertyType === 'land';
  const isCommercial = propertyType === 'commercial';
  const isDetached =
    propertyType === 'detached' || propertyType === 'detachedRent';

  const areaLabel = isLand
    ? '평균 거래면적'
    : isCommercial
      ? '평균 건물면적'
      : isDetached
        ? propertyType === 'detachedRent'
          ? '평균 계약면적'
          : '평균 연면적'
        : '평균 전용면적';

  const kpis: MetricItem[] = isRent
    ? [
        {
          id: 'tx-count',
          label: '전월세 거래 건수',
          unit: '건',
          value: summary ? summary.totalTransactions : null,
        },
        {
          id: 'tx-avg-deposit',
          label: '평균 보증금',
          unit: '만원',
          value: summary ? summary.avgPriceMan : null,
        },
        {
          id: 'tx-avg-rent',
          label: '평균 월세',
          unit: '만원',
          value: summary ? summary.avgMonthlyRentMan : null,
        },
        {
          id: 'tx-median-deposit',
          label: '중위 보증금',
          unit: '만원',
          value: summary ? summary.medianPriceMan : null,
        },
        {
          id: 'tx-area',
          label: areaLabel,
          unit: '㎡',
          value: summary ? summary.avgAreaSqm : null,
        },
        {
          id: 'tx-max-deposit',
          label: '최고 보증금',
          unit: '만원',
          value: summary ? summary.maxPriceMan : null,
        },
      ]
    : [
        {
          id: 'tx-count',
          label: '거래 건수',
          unit: '건',
          value: summary ? summary.totalTransactions : null,
        },
        {
          id: 'tx-avg',
          label: '평균 거래금액',
          unit: '만원',
          value: summary ? summary.avgPriceMan : null,
        },
        {
          id: 'tx-median',
          label: '중위 거래금액',
          unit: '만원',
          value: summary ? summary.medianPriceMan : null,
        },
        {
          id: 'tx-area',
          label: areaLabel,
          unit: '㎡',
          value: summary ? summary.avgAreaSqm : null,
        },
        {
          id: 'tx-unit',
          label: '㎡당 평균 단가',
          unit: '만원/㎡',
          value: summary ? summary.avgPricePerSqmMan : null,
        },
        {
          id: 'tx-max',
          label: '최고 거래금액',
          unit: '만원',
          value: summary ? summary.maxPriceMan : null,
        },
      ];

  const columns: TableColumn<TransactionRecord>[] = useMemo(() => {
    if (propertyType === 'detachedRent') {
      return [
        { key: 'name', header: '주택유형', render: (r) => r.propertyName },
        { key: 'dong', header: '법정동', render: (r) => r.dongName },
        {
          key: 'use',
          header: '계약구분',
          render: (r) =>
            r.contractType
              ? `${r.buildingUse} (${r.contractType})`
              : r.buildingUse,
        },
        {
          key: 'area',
          header: '계약면적 (㎡)',
          align: 'right',
          render: (r) => (r.areaSqm !== null ? r.areaSqm.toFixed(2) : ''),
        },
        {
          key: 'deposit',
          header: '보증금 (만원)',
          align: 'right',
          render: (r) =>
            r.priceMan !== null ? r.priceMan.toLocaleString('ko-KR') : '',
        },
        {
          key: 'monthlyRent',
          header: '월세 (만원)',
          align: 'right',
          render: (r) =>
            r.monthlyRentMan !== null
              ? r.monthlyRentMan.toLocaleString('ko-KR')
              : '',
        },
        { key: 'year', header: '건축년도', align: 'right', render: (r) => r.buildYear },
        { key: 'date', header: '계약일', align: 'right', render: (r) => r.dealDate },
      ];
    }

    if (isRent) {
      return [
        {
          key: 'name',
          header:
            propertyType === 'rowhouseRent'
              ? '건물명'
              : propertyType === 'officetelRent'
                ? '오피스텔명'
                : '단지명',
          render: (r) => r.propertyName,
        },
        { key: 'dong', header: '법정동', render: (r) => r.dongName },
        {
          key: 'use',
          header: '계약구분',
          render: (r) =>
            r.contractType
              ? `${r.buildingUse} (${r.contractType})`
              : r.buildingUse,
        },
        {
          key: 'area',
          header: '전용면적 (㎡)',
          align: 'right',
          render: (r) => (r.areaSqm !== null ? r.areaSqm.toFixed(2) : ''),
        },
        {
          key: 'deposit',
          header: '보증금 (만원)',
          align: 'right',
          render: (r) =>
            r.priceMan !== null ? r.priceMan.toLocaleString('ko-KR') : '',
        },
        {
          key: 'monthlyRent',
          header: '월세 (만원)',
          align: 'right',
          render: (r) =>
            r.monthlyRentMan !== null
              ? r.monthlyRentMan.toLocaleString('ko-KR')
              : '',
        },
        { key: 'floor', header: '층', align: 'right', render: (r) => r.floor },
        { key: 'year', header: '건축년도', align: 'right', render: (r) => r.buildYear },
        { key: 'date', header: '계약일', align: 'right', render: (r) => r.dealDate },
      ];
    }

    if (propertyType === 'detached') {
      return [
        { key: 'name', header: '주택유형', render: (r) => r.propertyName },
        { key: 'dong', header: '법정동', render: (r) => r.dongName },
        { key: 'jibun', header: '지번', render: (r) => r.jibun },
        {
          key: 'area',
          header: '연면적 (㎡)',
          align: 'right',
          render: (r) => (r.areaSqm !== null ? r.areaSqm.toFixed(2) : ''),
        },
        {
          key: 'plottage',
          header: '대지면적 (㎡)',
          align: 'right',
          render: (r) =>
            r.plottageAreaSqm !== null ? r.plottageAreaSqm.toFixed(2) : '',
        },
        {
          key: 'price',
          header: '거래금액 (만원)',
          align: 'right',
          render: (r) =>
            r.priceMan !== null ? r.priceMan.toLocaleString('ko-KR') : '',
        },
        {
          key: 'unitPrice',
          header: '단가 (만원/㎡)',
          align: 'right',
          render: (r) =>
            r.pricePerSqmMan !== null
              ? r.pricePerSqmMan.toLocaleString('ko-KR')
              : '',
        },
        { key: 'year', header: '건축년도', align: 'right', render: (r) => r.buildYear },
        { key: 'date', header: '계약일', align: 'right', render: (r) => r.dealDate },
      ];
    }

    if (isLand) {
      return [
        { key: 'dong', header: '법정동', render: (r) => r.dongName },
        { key: 'jibun', header: '지번', render: (r) => r.jibun },
        { key: 'jimok', header: '지목', render: (r) => r.jimok },
        { key: 'landUse', header: '용도지역', render: (r) => r.landUse },
        {
          key: 'area',
          header: '거래면적 (㎡)',
          align: 'right',
          render: (r) => (r.areaSqm !== null ? r.areaSqm.toFixed(2) : ''),
        },
        {
          key: 'price',
          header: '거래금액 (만원)',
          align: 'right',
          render: (r) =>
            r.priceMan !== null ? r.priceMan.toLocaleString('ko-KR') : '',
        },
        {
          key: 'unitPrice',
          header: '단가 (만원/㎡)',
          align: 'right',
          render: (r) =>
            r.pricePerSqmMan !== null
              ? r.pricePerSqmMan.toLocaleString('ko-KR')
              : '',
        },
        { key: 'date', header: '계약일', align: 'right', render: (r) => r.dealDate },
      ];
    }

    if (isCommercial) {
      return [
        { key: 'name', header: '건물용도·유형', render: (r) => r.propertyName },
        { key: 'dong', header: '법정동', render: (r) => r.dongName },
        { key: 'jibun', header: '지번', render: (r) => r.jibun },
        { key: 'landUse', header: '용도지역', render: (r) => r.landUse },
        {
          key: 'area',
          header: '건물면적 (㎡)',
          align: 'right',
          render: (r) => (r.areaSqm !== null ? r.areaSqm.toFixed(2) : ''),
        },
        {
          key: 'plottage',
          header: '대지면적 (㎡)',
          align: 'right',
          render: (r) =>
            r.plottageAreaSqm !== null ? r.plottageAreaSqm.toFixed(2) : '',
        },
        {
          key: 'price',
          header: '거래금액 (만원)',
          align: 'right',
          render: (r) =>
            r.priceMan !== null ? r.priceMan.toLocaleString('ko-KR') : '',
        },
        {
          key: 'unitPrice',
          header: '단가 (만원/㎡)',
          align: 'right',
          render: (r) =>
            r.pricePerSqmMan !== null
              ? r.pricePerSqmMan.toLocaleString('ko-KR')
              : '',
        },
        { key: 'year', header: '건축년도', align: 'right', render: (r) => r.buildYear },
        { key: 'date', header: '계약일', align: 'right', render: (r) => r.dealDate },
      ];
    }

    return [
      { key: 'name', header: '단지·건물명', render: (r) => r.propertyName },
      { key: 'dong', header: '법정동', render: (r) => r.dongName },
      { key: 'jibun', header: '지번', render: (r) => r.jibun },
      { key: 'use', header: '유형', render: (r) => r.buildingUse },
      {
        key: 'area',
        header: '전용면적 (㎡)',
        align: 'right',
        render: (r) => (r.areaSqm !== null ? r.areaSqm.toFixed(2) : ''),
      },
      {
        key: 'price',
        header: '거래금액 (만원)',
        align: 'right',
        render: (r) =>
          r.priceMan !== null ? r.priceMan.toLocaleString('ko-KR') : '',
      },
      {
        key: 'unitPrice',
        header: '단가 (만원/㎡)',
        align: 'right',
        render: (r) =>
          r.pricePerSqmMan !== null
            ? r.pricePerSqmMan.toLocaleString('ko-KR')
            : '',
      },
      { key: 'floor', header: '층', align: 'right', render: (r) => r.floor },
      { key: 'year', header: '건축년도', align: 'right', render: (r) => r.buildYear },
      { key: 'date', header: '계약일', align: 'right', render: (r) => r.dealDate },
    ];
  }, [isRent, isLand, isCommercial, propertyType]);

  return (
    <div className="space-y-6">
      {dataset?.error && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {dataset.error}
        </div>
      )}

      <MetricGrid items={kpis} columns={6} loading={loading} />

      <div className="space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center border border-slate-300 bg-white p-0.5">
            {PROPERTY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onPropertyTypeChange(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  propertyType === tab.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="단지명, 법정동, 유형, 지목 검색"
            className="h-9 px-3 text-xs bg-white border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 w-full xl:w-64 shrink-0"
          />
        </div>

        <DataTable
          columns={columns}
          rows={filteredItems}
          rowKey={(r) => r.id}
          emptyRows={8}
          loading={loading}
        />
      </div>

      <BuildingRegisterPanel
        data={buildingRegister}
        dongName={dongName}
        loading={loading}
      />
    </div>
  );
};
