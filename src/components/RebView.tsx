import React, { useMemo, useState } from 'react';
import type {
  DatasetResult,
  RebStatRecord,
  RebSummary,
} from '../types/analysis.ts';
import { DataTable, type TableColumn } from './DataTable.tsx';
import { MetricGrid, type MetricItem } from './MetricGrid.tsx';

interface RebViewProps {
  dataset: DatasetResult<RebStatRecord, RebSummary> | null;
  loading: boolean;
}

export const RebView: React.FC<RebViewProps> = ({ dataset, loading }) => {
  const [tableFilter, setTableFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const summary = dataset?.summary ?? null;
  const items = dataset?.items ?? [];

  const statTables = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.statTableName) set.add(item.statTableName);
    }
    return Array.from(set);
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return items.filter((item) => {
      if (tableFilter && item.statTableName !== tableFilter) return false;
      if (
        q &&
        !item.regionFullName.toLowerCase().includes(q) &&
        !item.statTableName.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [items, tableFilter, searchTerm]);

  const kpis: MetricItem[] = [
    {
      id: 'reb-land-index',
      label: '지역 지가지수',
      unit: '지수',
      value: summary?.landPriceIndex !== null && summary?.landPriceIndex !== undefined
        ? Number(summary.landPriceIndex.toFixed(2))
        : null,
      subtext:
        summary?.landPriceIndexPeriod && summary?.matchedRegionLabel
          ? `${summary.matchedRegionLabel} · ${summary.landPriceIndexPeriod}`
          : null,
    },
    {
      id: 'reb-land-rate',
      label: '지역 지가변동률',
      unit: '%',
      value: summary?.landChangeRate !== null && summary?.landChangeRate !== undefined
        ? Number(summary.landChangeRate.toFixed(3))
        : null,
      subtext: summary?.landChangeRatePeriod ?? null,
    },
    {
      id: 'reb-apt-sale',
      label: '아파트 매매가격지수',
      unit: '지수',
      value: summary?.aptSaleIndex !== null && summary?.aptSaleIndex !== undefined
        ? Number(summary.aptSaleIndex.toFixed(2))
        : null,
      subtext: summary?.aptSaleIndexPeriod ?? null,
    },
    {
      id: 'reb-apt-jeonse',
      label: '아파트 전세가격지수',
      unit: '지수',
      value: summary?.aptJeonseIndex !== null && summary?.aptJeonseIndex !== undefined
        ? Number(summary.aptJeonseIndex.toFixed(2))
        : null,
      subtext: summary?.aptJeonseIndexPeriod ?? null,
    },
  ];

  const columns: TableColumn<RebStatRecord>[] = [
    { key: 'table', header: '통계표명', render: (r) => r.statTableName },
    { key: 'region', header: '지역 구분', render: (r) => r.regionFullName },
    { key: 'item', header: '항목', render: (r) => r.itemName },
    { key: 'period', header: '기준 시점', render: (r) => r.periodLabel },
    {
      key: 'value',
      header: '수치',
      align: 'right',
      render: (r) => (r.value !== null ? r.value.toFixed(3) : ''),
    },
    { key: 'unit', header: '단위', align: 'right', render: (r) => r.unit },
  ];

  return (
    <div className="space-y-6">
      {dataset?.error && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {dataset.error}
        </div>
      )}

      <MetricGrid items={kpis} columns={4} loading={loading} />

      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <select
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            aria-label="통계표 필터"
            className="h-9 px-3 text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
          >
            <option value="">전체 한국부동산원 통계표</option>
            {statTables.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="지역명 또는 통계표명 검색"
            className="h-9 px-3 text-xs bg-white border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 w-full sm:w-64"
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
    </div>
  );
};
