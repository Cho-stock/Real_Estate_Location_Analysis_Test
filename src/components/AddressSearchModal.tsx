import React, { useEffect, useMemo, useState } from 'react';
import { Building2, MapPin, Search, X } from 'lucide-react';
import type { SearchPlaceCandidate } from '../types/analysis.ts';

interface AddressSearchModalProps {
  open: boolean;
  initialQuery: string;
  candidates: SearchPlaceCandidate[];
  totalCount: number;
  pageableCount: number;
  page: number;
  isEnd: boolean;
  loading: boolean;
  resolvingId: string | null;
  error: string | null;
  onClose: () => void;
  onSearch: (query: string, page: number) => void;
  onSelect: (candidate: SearchPlaceCandidate) => void;
}

const SIDO_FILTERS = [
  '전체',
  '서울',
  '경기',
  '인천',
  '부산',
  '대구',
  '대전',
  '광주',
  '울산',
  '세종',
  '강원',
  '충북',
  '충남',
  '전북',
  '전남',
  '경북',
  '경남',
  '제주',
] as const;

const SIDO_PREFIX_REGEX =
  /^(서울(?:특별시)?|경기(?:도)?|인천(?:광역시)?|부산(?:광역시)?|대구(?:광역시)?|대전(?:광역시)?|광주(?:광역시)?|울산(?:광역시)?|세종(?:특별자치시)?|강원(?:특별자치도|도)?|충북|충청북도|충남|충청남도|전북|전북특별자치도|전라북도|전남|전라남도|경북|경상북도|경남|경상남도|제주(?:특별자치도|도)?)\s+/;

export const AddressSearchModal: React.FC<AddressSearchModalProps> = ({
  open,
  initialQuery,
  candidates,
  totalCount,
  pageableCount,
  page,
  isEnd,
  loading,
  resolvingId,
  error,
  onClose,
  onSearch,
  onSelect,
}) => {
  const [modalQuery, setModalQuery] = useState(initialQuery);
  const [selectedSido, setSelectedSido] = useState<string>('전체');
  const [residentialOnly, setResidentialOnly] = useState(false);

  useEffect(() => {
    if (open) {
      setModalQuery(initialQuery);
      const match = initialQuery.trim().match(SIDO_PREFIX_REGEX);
      if (match) {
        const prefix = match[1].slice(0, 2);
        setSelectedSido(
          SIDO_FILTERS.includes(prefix as (typeof SIDO_FILTERS)[number])
            ? prefix
            : '전체'
        );
      } else {
        setSelectedSido('전체');
      }
      setResidentialOnly(false);
    }
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const filteredCandidates = useMemo(() => {
    if (!residentialOnly) return candidates;
    return candidates.filter(
      (c) =>
        c.source === 'address' ||
        c.categoryName.includes('주거시설') ||
        c.categoryName.includes('아파트') ||
        c.categoryName.includes('오피스텔')
    );
  }, [candidates, residentialOnly]);

  if (!open) return null;

  const handleSidoClick = (sido: string) => {
    setSelectedSido(sido);
    const baseQuery = modalQuery.trim().replace(SIDO_PREFIX_REGEX, '').trim();
    if (!baseQuery) return;
    const nextQuery = sido === '전체' ? baseQuery : `${sido} ${baseQuery}`;
    setModalQuery(nextQuery);
    onSearch(nextQuery, 1);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = modalQuery.trim();
    if (!trimmed) return;
    onSearch(trimmed, 1);
  };

  const totalPages = Math.max(1, Math.min(3, Math.ceil(pageableCount / 15)));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="address-search-modal-title"
    >
      <div
        className="w-full max-w-3xl bg-white border border-slate-300 shadow-xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="address-search-modal-title"
              className="text-sm font-semibold text-slate-900"
            >
              카카오 주소 · 단지 위치 선택
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              동명·구명(예: 압구정 현대아파트, 분당 현대아파트)을 함께
              입력하거나 시·도를 선택해 원하는 위치를 좁혀보세요.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="검색 팝업 닫기"
            className="p-1.5 text-slate-400 hover:text-slate-900 border border-transparent hover:border-slate-200 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 space-y-2.5">
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={modalQuery}
                onChange={(e) => setModalQuery(e.target.value)}
                placeholder="예: 서울 강남구 현대아파트, 분당 현대아파트, 삼성로135길 42"
                autoFocus
                className="w-full h-9 pl-8 pr-3 text-xs bg-white border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !modalQuery.trim()}
              className="h-9 px-4 bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {loading ? '검색 중...' : '재검색'}
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-1">
            {SIDO_FILTERS.map((sido) => (
              <button
                key={sido}
                type="button"
                onClick={() => handleSidoClick(sido)}
                className={`px-2 py-1 text-[11px] font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedSido === sido
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400 hover:text-slate-900'
                }`}
              >
                {sido}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <span className="font-mono tabular-nums">
              {totalCount > 0
                ? `검색 결과 총 ${totalCount.toLocaleString('ko-KR')}건 (현재 ${filteredCandidates.length}건 표시)`
                : '검색 결과 없음'}
            </span>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={residentialOnly}
                onChange={(e) => setResidentialOnly(e.target.checked)}
                className="accent-blue-700"
              />
              <span>아파트 · 주거시설 · 주소만 보기</span>
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
          {loading ? (
            Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="px-5 py-3.5 space-y-2">
                <div className="h-4 w-48 bg-slate-100 animate-pulse" />
                <div className="h-3 w-72 bg-slate-100 animate-pulse" />
              </div>
            ))
          ) : error && filteredCandidates.length === 0 ? (
            <div className="px-5 py-10 text-center text-xs text-slate-500">
              {error}
            </div>
          ) : filteredCandidates.length === 0 ? (
            <div className="px-5 py-10 text-center text-xs text-slate-500">
              조건에 맞는 위치가 없습니다. 시·도를 변경하거나 검색어를 구체적으로
              입력해 보세요.
            </div>
          ) : (
            filteredCandidates.map((cand) => {
              const categoryLeaf =
                cand.categoryName.split('>').pop()?.trim() || cand.categoryName;
              const isResidential = cand.categoryName.includes('주거시설');
              const isResolving = resolvingId === cand.id;
              return (
                <button
                  key={cand.id}
                  type="button"
                  disabled={Boolean(resolvingId)}
                  onClick={() => onSelect(cand)}
                  className="w-full px-5 py-3 text-left hover:bg-blue-50/50 transition-colors flex items-center justify-between gap-4 disabled:opacity-60 cursor-pointer"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isResidential ? (
                        <Building2 className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                      ) : (
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                      <span className="text-xs font-semibold text-slate-900">
                        {cand.placeName}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 text-[10px] font-medium border whitespace-nowrap ${
                          isResidential
                            ? 'border-blue-200 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-slate-100 text-slate-600'
                        }`}
                      >
                        {categoryLeaf}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 truncate pl-5">
                      {cand.roadAddress || cand.lotAddress}
                      {cand.roadAddress &&
                        cand.lotAddress &&
                        cand.roadAddress !== cand.lotAddress && (
                          <span className="text-slate-400 ml-2">
                            ({cand.lotAddress})
                          </span>
                        )}
                    </div>
                  </div>
                  <span className="px-2.5 py-1 text-[11px] font-medium border border-slate-300 bg-white text-slate-700 hover:border-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0">
                    {isResolving ? '이동 중...' : '이 위치 선택'}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500">
            카카오 로컬 검색 기준 상위 최대 45건 페이지 조회 지원
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={loading || page <= 1}
              onClick={() => onSearch(modalQuery, page - 1)}
              className="h-7 px-2.5 text-xs border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
            >
              이전
            </button>
            {Array.from({ length: totalPages }).map((_, idx) => {
              const p = idx + 1;
              return (
                <button
                  key={p}
                  type="button"
                  disabled={loading}
                  onClick={() => onSearch(modalQuery, p)}
                  className={`h-7 w-7 text-xs font-mono tabular-nums border cursor-pointer ${
                    page === p
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              type="button"
              disabled={loading || isEnd || page >= 3}
              onClick={() => onSearch(modalQuery, page + 1)}
              className="h-7 px-2.5 text-xs border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
            >
              다음
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
