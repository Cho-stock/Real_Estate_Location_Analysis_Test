import React from 'react';

export interface DistributionRow {
  label: string;
  count: number | null;
  ratio: number | null;
}

interface DistributionPanelProps {
  title: string;
  subtitle?: string;
  rows: DistributionRow[];
  emptySlotCount?: number;
  barColorClass?: string;
  loading?: boolean;
}

export const DistributionPanel: React.FC<DistributionPanelProps> = ({
  title,
  subtitle,
  rows,
  emptySlotCount = 5,
  barColorClass = 'bg-blue-600',
  loading = false,
}) => {
  const hasData = rows.length > 0;
  const displayRows: DistributionRow[] = hasData
    ? rows
    : Array.from({ length: emptySlotCount }, () => ({
        label: '',
        count: null,
        ratio: null,
      }));

  return (
    <div className="border border-slate-200 bg-white flex flex-col">
      <div className="px-5 py-4 border-b border-slate-200">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle && (
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        )}
      </div>

      <div className="p-5 flex-1 flex flex-col justify-between gap-3.5">
        {loading
          ? Array.from({ length: emptySlotCount }).map((_, idx) => (
              <div key={idx} className="space-y-1.5">
                <div className="h-3.5 w-28 bg-slate-100 animate-pulse" />
                <div className="h-2.5 w-full bg-slate-100 animate-pulse" />
              </div>
            ))
          : displayRows.map((row, idx) => {
              const ratioVal =
                row.ratio !== null ? Math.min(100, Math.max(0, row.ratio)) : 0;

              return (
                <div key={idx} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-xs min-h-[18px]">
                    <span className="text-slate-700 font-medium truncate">
                      {row.label || '\u00A0'}
                    </span>
                    <span className="font-mono tabular-nums text-slate-600 shrink-0">
                      {row.count !== null && row.ratio !== null
                        ? `${row.count.toLocaleString('ko-KR')}건 · ${row.ratio.toFixed(1)}%`
                        : '\u00A0'}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 overflow-hidden">
                    {row.ratio !== null && (
                      <div
                        className={`h-full ${barColorClass} transition-all duration-200`}
                        style={{ width: `${ratioVal}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
      </div>
    </div>
  );
};
