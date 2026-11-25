import React from 'react';
import { CheckCircle2, CircleSlash } from 'lucide-react';
import type { ApiSourceSpec } from '../types/analysis.ts';

interface ApiSpecsViewProps {
  sources: ApiSourceSpec[];
  loading: boolean;
}

export const ApiSpecsView: React.FC<ApiSpecsViewProps> = ({
  sources,
  loading,
}) => {
  return (
    <div className="space-y-6">
      <div className="border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">
          공공데이터 서버 프록시 연동 규격
        </h2>
        <p className="text-xs text-slate-600 mt-1.5 leading-relaxed max-w-3xl">
          모든 외부 공공 API 호출은 서버 측 프록시(/api/*)를 통해 실행되며, 인증키는
          서버 환경변수(Secrets / .env)에서 읽어옵니다. 환경변수가 아직 설정되지
          않았거나 수신 데이터가 없는 경우 화면의 모든 지표와 테이블 행은 목업 없이
          빈칸으로 유지됩니다.
        </p>
      </div>

      <div className="border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                데이터 소스
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                환경변수 키
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                연결 상태
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                연동 엔드포인트
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                주요 추출 필드
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-xs">
            {loading
              ? Array.from({ length: 4 }).map((_, idx) => (
                  <tr key={idx} className="h-14">
                    <td colSpan={5} className="px-4 py-3">
                      <div className="h-4 w-full bg-slate-100 animate-pulse" />
                    </td>
                  </tr>
                ))
              : sources.map((src) => (
                  <tr key={src.id} className="align-top hover:bg-slate-50/70">
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-slate-900">{src.name}</div>
                      <div className="text-slate-500 mt-0.5">{src.provider}</div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-slate-800 whitespace-nowrap">
                      {src.envVar}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {src.configured ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          연결됨
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-slate-500">
                          <CircleSlash className="w-3.5 h-3.5" />
                          미연결
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[11px] text-slate-600 max-w-xs break-all">
                      {src.endpoint}
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      {src.outputFields.join(' · ')}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
