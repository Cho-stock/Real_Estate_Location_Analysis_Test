import React, { useMemo, useState } from 'react';
import type {
  CommercialStoreRecord,
  CommercialSummary,
  DatasetResult,
} from '../types/analysis.ts';
import { DataTable, type TableColumn } from './DataTable.tsx';
import { DistributionPanel } from './DistributionPanel.tsx';
import { MetricGrid, type MetricItem } from './MetricGrid.tsx';

interface CommercialViewProps {
  dataset: DatasetResult<CommercialStoreRecord, CommercialSummary> | null;
  radius: number;
  loading: boolean;
}

export const CommercialView: React.FC<CommercialViewProps> = ({
  dataset,
  radius,
  loading,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const summary = dataset?.summary ?? null;
  const items = dataset?.items ?? [];

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.largeCategoryName) set.add(item.largeCategoryName);
    }
    return Array.from(set);
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return items.filter((item) => {
      if (categoryFilter && item.largeCategoryName !== categoryFilter) {
        return false;
      }
      if (
        q &&
        !item.name.toLowerCase().includes(q) &&
        !item.roadAddress.toLowerCase().includes(q) &&
        !item.smallCategoryName.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [items, categoryFilter, searchTerm]);

  const kpis: MetricItem[] = [
    {
      id: 'commercial-total',
      label: '상가 업소 수',
      unit: '개소',
      value: summary ? summary.totalStores : null,
      subtext: summary ? `반경 ${radius}m 또는 행정동 기준` : null,
    },
    {
      id: 'commercial-density',
      label: '단위 면적 밀집도',
      unit: '개/km²',
      value: summary ? summary.densityPerSqKm : null,
    },
    {
      id: 'commercial-top-cat',
      label: '최다 업종',
      value: summary ? summary.topCategoryName : null,
      subtext:
        summary && summary.topCategoryRatio !== null
          ? `전체 비중 ${summary.topCategoryRatio}%`
          : null,
    },
    {
      id: 'commercial-1f',
      label: '1층 점포 비중',
      unit: '%',
      value: summary ? summary.firstFloorRatio : null,
      subtext:
        summary && summary.firstFloorCount > 0
          ? `${summary.firstFloorCount.toLocaleString('ko-KR')}개소`
          : null,
    },
  ];

  const categoryRows = (summary?.categoryDistribution ?? []).map((c) => ({
    label: c.categoryName,
    count: c.count,
    ratio: c.ratio,
  }));

  const floorRows = (summary?.floorDistribution ?? []).map((f) => ({
    label: f.label,
    count: f.count,
    ratio: f.ratio,
  }));

  const columns: TableColumn<CommercialStoreRecord>[] = [
    { key: 'name', header: '상호명', render: (r) => r.name },
    { key: 'lcls', header: '대분류', render: (r) => r.largeCategoryName },
    { key: 'mcls', header: '중분류', render: (r) => r.mediumCategoryName },
    { key: 'scls', header: '소분류', render: (r) => r.smallCategoryName },
    { key: 'floor', header: '층', align: 'right', render: (r) => r.floor },
    {
      key: 'dist',
      header: '거리 (m)',
      align: 'right',
      render: (r) =>
        r.distanceMeters !== null ? r.distanceMeters.toLocaleString('ko-KR') : '',
    },
    { key: 'addr', header: '도로명주소', render: (r) => r.roadAddress || r.lotAddress },
  ];

  return (
    <div className="space-y-6">
      {dataset?.error && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {dataset.error}
        </div>
      )}

      <MetricGrid items={kpis} columns={4} loading={loading} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DistributionPanel
          title="업종 대분류 분포"
          subtitle="상가업소 대분류별 점유 현황"
          rows={categoryRows}
          emptySlotCount={6}
          barColorClass="bg-blue-600"
          loading={loading}
        />
        <DistributionPanel
          title="층별 입지 분포"
          subtitle="1층 · 상층부 · 지하층 점포 구성"
          rows={floorRows}
          emptySlotCount={4}
          barColorClass="bg-slate-700"
          loading={loading}
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="업종 대분류 필터"
              className="h-9 px-3 text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
            >
              <option value="">전체 업종 대분류</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="상호명, 소분류, 도로명주소 검색"
            className="h-9 px-3 text-xs bg-white border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 w-full sm:w-72"
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
