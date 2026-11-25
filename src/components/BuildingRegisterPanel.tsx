import React from 'react';
import { DataTable, type TableColumn } from './DataTable.tsx';
import type {
  BuildingRegisterResult,
  ClosedBuildingRecord,
} from '../types/analysis.ts';

interface BuildingRegisterPanelProps {
  data: BuildingRegisterResult | null;
  dongName?: string;
  loading: boolean;
}

const CLOSED_COLUMNS: TableColumn<ClosedBuildingRecord>[] = [
  {
    key: 'closureDate',
    header: '말소일자',
    render: (r) => (
      <span className="font-mono tabular-nums text-slate-700">
        {r.closureDate}
      </span>
    ),
  },
  {
    key: 'closureType',
    header: '구분',
    render: (r) => (
      <span className="inline-block px-1.5 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
        {r.closureTypeName}
      </span>
    ),
  },
  {
    key: 'buildingName',
    header: '구 건물명 · 동명',
    render: (r) => (
      <span className="font-medium text-slate-900">{r.buildingName}</span>
    ),
  },
  {
    key: 'lotAddress',
    header: '대지위치',
    render: (r) => r.lotAddress,
  },
  {
    key: 'purpose',
    header: '주용도 · 구조',
    render: (r) =>
      [r.mainPurpose, r.structure].filter(Boolean).join(' / '),
  },
  {
    key: 'totArea',
    header: '연면적 (㎡)',
    align: 'right',
    render: (r) =>
      r.totAreaSqm !== null ? r.totAreaSqm.toLocaleString('ko-KR') : '',
  },
  {
    key: 'floors',
    header: '규모',
    render: (r) => r.floorsLabel,
  },
  {
    key: 'approval',
    header: '당초 사용승인',
    align: 'right',
    render: (r) => (
      <span className="font-mono tabular-nums text-slate-500">
        {r.useApprovalDate}
      </span>
    ),
  },
];

function formatNumberUnit(
  value: number | null | undefined,
  unit: string
): string {
  if (value === null || value === undefined) return '';
  return `${value.toLocaleString('ko-KR')}${unit}`;
}

export const BuildingRegisterPanel: React.FC<BuildingRegisterPanelProps> = ({
  data,
  dongName,
  loading,
}) => {
  const summary = data?.summary ?? null;
  const closedRecords = data?.closedRecords ?? [];

  const scaleLabelParts: string[] = [];
  if (summary?.maxGroundFloors) {
    scaleLabelParts.push(`지상 ${summary.maxGroundFloors}층`);
  }
  if (summary?.maxUndergroundFloors) {
    scaleLabelParts.push(`지하 ${summary.maxUndergroundFloors}층`);
  }
  if (summary?.mainBuildingCount && summary.mainBuildingCount > 1) {
    scaleLabelParts.push(`주 ${summary.mainBuildingCount}개동`);
  }

  const unitLabel = summary?.householdCount
    ? `${summary.householdCount.toLocaleString('ko-KR')}세대`
    : summary?.hoCount
      ? `${summary.hoCount.toLocaleString('ko-KR')}호`
      : '';

  const parkingLabel =
    summary?.totalParkingCount !== null &&
    summary?.totalParkingCount !== undefined
      ? summary.parkingPerHousehold !== null
        ? `${summary.totalParkingCount.toLocaleString('ko-KR')}대 (세대당 ${summary.parkingPerHousehold.toFixed(2)}대)`
        : `${summary.totalParkingCount.toLocaleString('ko-KR')}대`
      : '';

  const approvalLabel = summary?.useApprovalDate
    ? summary.buildingAgeYears !== null
      ? `${summary.useApprovalDate} (${summary.buildingAgeYears}년차)`
      : summary.useApprovalDate
    : '';

  const closedHeaderNote =
    data?.closedScope === 'parcel'
      ? `해당 지번 폐쇄·말소 이력 ${closedRecords.length}건`
      : data?.closedScope === 'dong'
        ? `해당 지번 이력 없음 · ${dongName ? `${dongName} ` : '법정동 '}최근 폐쇄·말소 ${closedRecords.length}건`
        : '';

  return (
    <div className="space-y-4">
      <div className="border border-slate-200 bg-white">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-slate-900">
                대상 건축물대장 요약
              </h3>
              {summary?.regstrKindName && (
                <span className="px-1.5 py-0.5 text-[11px] font-medium border border-slate-200 bg-slate-50 text-slate-600">
                  {summary.regstrKindName}
                </span>
              )}
              {summary?.seismicDesignApplied === true && (
                <span className="px-1.5 py-0.5 text-[11px] font-medium border border-emerald-200 bg-emerald-50 text-emerald-700">
                  내진설계 적용
                </span>
              )}
              {summary?.greenBuildingGrade && (
                <span className="px-1.5 py-0.5 text-[11px] font-medium border border-blue-200 bg-blue-50 text-blue-700">
                  녹색건축 {summary.greenBuildingGrade}등급
                </span>
              )}
              {summary?.violationFlag === true && (
                <span className="px-1.5 py-0.5 text-[11px] font-medium border border-red-200 bg-red-50 text-red-700">
                  위반건축물 등재
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {summary
                ? [summary.pnuLabel, summary.roadAddress]
                    .filter(Boolean)
                    .join(' · ')
                : data?.sigunguCd && data?.bun
                  ? `법정동 ${data.sigunguCd}${data.bjdongCd} · ${Number(data.bun)}-${Number(data.ji)}번지`
                  : '국토교통부 건축HUB 기준 선택 위치·지번 건축물대장'}
            </p>
          </div>
          {data?.error && (
            <span className="text-xs text-red-600 shrink-0">{data.error}</span>
          )}
        </div>

        {loading ? (
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, idx) => (
              <div key={idx} className="space-y-1.5">
                <div className="h-3 w-16 bg-slate-100 animate-pulse" />
                <div className="h-4 w-24 bg-slate-100 animate-pulse" />
              </div>
            ))}
          </div>
        ) : summary ? (
          <div className="divide-y divide-slate-200">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
              <div className="px-4 py-3">
                <div className="text-[11px] text-slate-500">건물명</div>
                <div className="text-xs font-semibold text-slate-900 mt-1 truncate">
                  {summary.buildingName || '-'}
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="text-[11px] text-slate-500">주용도</div>
                <div className="text-xs font-medium text-slate-800 mt-1 truncate">
                  {summary.mainPurpose || '-'}
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="text-[11px] text-slate-500">용도지역 · 지구</div>
                <div className="text-xs font-medium text-slate-800 mt-1 truncate">
                  {summary.zoning || '-'}
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="text-[11px] text-slate-500">주구조</div>
                <div className="text-xs font-medium text-slate-800 mt-1 truncate">
                  {summary.structure || '-'}
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="text-[11px] text-slate-500">규모 · 층수</div>
                <div className="text-xs font-medium text-slate-800 mt-1 tabular-nums">
                  {scaleLabelParts.join(' · ') || '-'}
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="text-[11px] text-slate-500">사용승인일</div>
                <div className="text-xs font-medium text-slate-800 mt-1 font-mono tabular-nums">
                  {approvalLabel || '-'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-slate-50/40">
              <div className="px-4 py-3">
                <div className="text-[11px] text-slate-500">대지면적</div>
                <div className="text-xs font-semibold text-slate-900 mt-1 font-mono tabular-nums">
                  {formatNumberUnit(summary.platAreaSqm, '㎡') || '-'}
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="text-[11px] text-slate-500">연면적</div>
                <div className="text-xs font-semibold text-slate-900 mt-1 font-mono tabular-nums">
                  {formatNumberUnit(summary.totAreaSqm, '㎡') || '-'}
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="text-[11px] text-slate-500">건폐율</div>
                <div className="text-xs font-semibold text-slate-900 mt-1 font-mono tabular-nums">
                  {formatNumberUnit(summary.bcRatPct, '%') || '-'}
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="text-[11px] text-slate-500">용적률</div>
                <div className="text-xs font-semibold text-blue-700 mt-1 font-mono tabular-nums">
                  {formatNumberUnit(summary.vlRatPct, '%') || '-'}
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="text-[11px] text-slate-500">세대 · 호수</div>
                <div className="text-xs font-semibold text-slate-900 mt-1 font-mono tabular-nums">
                  {unitLabel || '-'}
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="text-[11px] text-slate-500">
                  주차 · 승강기
                </div>
                <div className="text-xs font-semibold text-slate-900 mt-1 tabular-nums">
                  {[
                    parkingLabel,
                    summary.elevatorCount !== null
                      ? `승강기 ${summary.elevatorCount}대`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ') || '-'}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-4 py-5 text-xs text-slate-400">
            해당 위치 지번의 건축물대장 정보가 조회되지 않았습니다. (지도에서 건물
            위치를 클릭하거나 정확한 주소·단지를 선택해 조회할 수 있습니다.)
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">
            폐쇄 · 말소 대장 이력
          </h3>
          <span className="text-xs text-slate-400 font-mono tabular-nums">
            {closedHeaderNote || '\u00A0'}
          </span>
        </div>
        <DataTable
          columns={CLOSED_COLUMNS}
          rows={closedRecords}
          rowKey={(r) => r.id}
          emptyRows={3}
          loading={loading}
        />
      </div>
    </div>
  );
};
