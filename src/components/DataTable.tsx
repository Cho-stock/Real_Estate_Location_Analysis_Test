import React from 'react';

export interface TableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  widthClass?: string;
  render: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  emptyRows?: number;
  loading?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyRows = 6,
  loading = false,
}: DataTableProps<T>) {
  const hasRows = rows.length > 0;

  return (
    <div className="border border-slate-200 bg-white overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-2.5 text-xs font-semibold text-slate-600 whitespace-nowrap ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                } ${col.widthClass ?? ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 text-[13px]">
          {loading
            ? Array.from({ length: emptyRows }).map((_, idx) => (
                <tr key={`skeleton-${idx}`} className="h-10">
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-2.5">
                      <div className="h-3.5 w-4/5 bg-slate-100 animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            : hasRows
              ? rows.map((row, idx) => (
                  <tr
                    key={rowKey(row, idx)}
                    className="h-10 hover:bg-slate-50/80 transition-colors"
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-4 py-2 text-slate-800 whitespace-nowrap ${
                          col.align === 'right'
                            ? 'text-right font-mono tabular-nums'
                            : 'text-left'
                        }`}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))
              : Array.from({ length: emptyRows }).map((_, idx) => (
                  <tr key={`blank-${idx}`} className="h-10">
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-2 text-slate-300">
                        {'\u00A0'}
                      </td>
                    ))}
                  </tr>
                ))}
        </tbody>
      </table>
    </div>
  );
}
