import React, { useMemo, useState } from 'react';
import { SCHOOL_KIND_OPTIONS } from '../data/regions.ts';
import type {
  DatasetResult,
  SchoolRecord,
  SchoolSummary,
} from '../types/analysis.ts';
import { DataTable, type TableColumn } from './DataTable.tsx';
import { DistributionPanel } from './DistributionPanel.tsx';
import { MetricGrid, type MetricItem } from './MetricGrid.tsx';

interface SchoolsViewProps {
  dataset: DatasetResult<SchoolRecord, SchoolSummary> | null;
  loading: boolean;
}

export const SchoolsView: React.FC<SchoolsViewProps> = ({
  dataset,
  loading,
}) => {
  const [kindFilter, setKindFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const summary = dataset?.summary ?? null;
  const items = dataset?.items ?? [];

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return items.filter((item) => {
      if (kindFilter && item.kindCode !== kindFilter) return false;
      if (
        q &&
        !item.name.toLowerCase().includes(q) &&
        !item.address.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [items, kindFilter, searchTerm]);

  const kpis: MetricItem[] = [
    {
      id: 'total-schools',
      label: '전체 학교 수',
      unit: '개교',
      value: summary ? summary.totalSchools : null,
    },
    {
      id: 'elem-schools',
      label: '초등학교',
      unit: '개교',
      value: summary ? summary.elementaryCount : null,
    },
    {
      id: 'mid-schools',
      label: '중학교',
      unit: '개교',
      value: summary ? summary.middleCount : null,
    },
    {
      id: 'high-schools',
      label: '고등학교',
      unit: '개교',
      value: summary ? summary.highCount : null,
    },
    {
      id: 'total-students',
      label: '총 학생 수',
      unit: '명',
      value: summary ? summary.totalStudents : null,
    },
    {
      id: 'students-per-teacher',
      label: '교원 1인당 학생 수',
      unit: '명',
      value: summary ? summary.studentsPerTeacher : null,
    },
  ];

  const columns: TableColumn<SchoolRecord>[] = [
    { key: 'name', header: '학교명', render: (r) => r.name },
    { key: 'kind', header: '학교급', render: (r) => r.kindName },
    { key: 'fond', header: '설립구분', render: (r) => r.foundationType },
    { key: 'coed', header: '남녀공학', render: (r) => r.coedType },
    {
      key: 'students',
      header: '학생 수',
      align: 'right',
      render: (r) =>
        r.studentCount !== null ? r.studentCount.toLocaleString('ko-KR') : '',
    },
    {
      key: 'teachers',
      header: '교원 수',
      align: 'right',
      render: (r) =>
        r.teacherCount !== null ? r.teacherCount.toLocaleString('ko-KR') : '',
    },
    {
      key: 'dist',
      header: '기준점 거리 (m)',
      align: 'right',
      render: (r) =>
        r.distanceMeters !== null ? r.distanceMeters.toLocaleString('ko-KR') : '',
    },
    { key: 'address', header: '주소', render: (r) => r.address },
  ];

  const kindRows = (summary?.kindDistribution ?? []).map((k) => ({
    label: k.kindName,
    count: k.count,
    ratio: k.ratio,
  }));

  return (
    <div className="space-y-6">
      {dataset?.error && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {dataset.error}
        </div>
      )}

      <MetricGrid items={kpis} columns={6} loading={loading} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4">
          <DistributionPanel
            title="학교급별 비율"
            subtitle="학교알리미 공시 학교급 구성"
            rows={kindRows}
            emptySlotCount={4}
            barColorClass="bg-amber-600"
            loading={loading}
          />
        </div>

        <div className="lg:col-span-8 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="inline-flex items-center border border-slate-300 bg-white p-0.5">
              {SCHOOL_KIND_OPTIONS.map((opt) => (
                <button
                  key={opt.code || 'all'}
                  type="button"
                  onClick={() => setKindFilter(opt.code)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    kindFilter === opt.code
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="학교명 또는 주소 검색"
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
    </div>
  );
};
