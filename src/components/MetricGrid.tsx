import React from 'react';

export interface MetricItem {
  id: string;
  label: string;
  value: string | number | null | undefined;
  unit?: string;
  subtext?: string | null;
}

interface MetricGridProps {
  items: MetricItem[];
  columns?: 3 | 4 | 6;
  loading?: boolean;
}

export const MetricGrid: React.FC<MetricGridProps> = ({
  items,
  columns = 4,
  loading = false,
}) => {
  const gridColsClass =
    columns === 6
      ? 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6'
      : columns === 3
        ? 'grid-cols-1 sm:grid-cols-3'
        : 'grid-cols-2 lg:grid-cols-4';

  return (
    <div
      className={`grid ${gridColsClass} border border-slate-200 bg-white divide-y sm:divide-y-0 sm:divide-x divide-slate-200`}
    >
      {items.map((item) => {
        const hasValue =
          item.value !== null &&
          item.value !== undefined &&
          String(item.value).trim() !== '';

        return (
          <div key={item.id} className="p-5 flex flex-col justify-between min-h-[108px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 truncate">
                {item.label}
              </span>
              {item.unit && (
                <span className="text-[11px] text-slate-400 shrink-0">
                  {item.unit}
                </span>
              )}
            </div>

            <div className="mt-3 min-h-[32px] flex items-baseline">
              {loading ? (
                <div className="h-6 w-24 bg-slate-100 animate-pulse rounded-xs" />
              ) : hasValue ? (
                <span className="text-2xl font-semibold tracking-tight text-slate-900 font-mono tabular-nums">
                  {typeof item.value === 'number'
                    ? item.value.toLocaleString('ko-KR')
                    : item.value}
                </span>
              ) : (
                <span
                  className="block h-7 w-full border-b border-dashed border-slate-200"
                  aria-label="데이터 없음"
                >
                  {'\u00A0'}
                </span>
              )}
            </div>

            <div className="mt-2 min-h-[16px] text-xs text-slate-400 truncate">
              {hasValue && item.subtext ? item.subtext : '\u00A0'}
            </div>
          </div>
        );
      })}
    </div>
  );
};
