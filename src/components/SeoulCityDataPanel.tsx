import React, { useEffect, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import type {
  SeoulCityDataSummary,
  SeoulTransitIntervalStat,
} from '../types/analysis.ts';

interface SeoulCityDataPanelProps {
  data: SeoulCityDataSummary | null;
  centerLat?: string;
  centerLng?: string;
  loading: boolean;
  activeMapAreaCode?: string | null;
  onShowAreaOnMap?: (summary: SeoulCityDataSummary | null) => void;
}

function getIntervalMid(minVal: number | null, maxVal: number | null): number {
  if (minVal !== null && maxVal !== null) return Math.round((minVal + maxVal) / 2);
  return maxVal ?? minVal ?? 0;
}

function formatPeopleRange(
  minVal: number | null,
  maxVal: number | null
): string {
  if (minVal === null && maxVal === null) return '-';
  if (minVal !== null && maxVal !== null && minVal !== maxVal) {
    return `${minVal.toLocaleString('ko-KR')}~${maxVal.toLocaleString('ko-KR')}명`;
  }
  const v = maxVal ?? minVal ?? 0;
  return `${v.toLocaleString('ko-KR')}명`;
}

function formatWonRangeCompact(
  minWon: number | null | undefined,
  maxWon: number | null | undefined
): string {
  if (minWon === null || minWon === undefined) {
    if (maxWon === null || maxWon === undefined) return '-';
    return formatSingleWon(maxWon);
  }
  if (maxWon === null || maxWon === undefined || minWon === maxWon) {
    return formatSingleWon(minWon);
  }
  if (maxWon >= 100_000_000) {
    return `${(minWon / 100_000_000).toFixed(1)}~${(maxWon / 100_000_000).toFixed(1)}억원`;
  }
  if (maxWon >= 10_000) {
    return `${Math.round(minWon / 10_000).toLocaleString('ko-KR')}~${Math.round(
      maxWon / 10_000
    ).toLocaleString('ko-KR')}만원`;
  }
  return `${minWon.toLocaleString('ko-KR')}~${maxWon.toLocaleString('ko-KR')}원`;
}

function formatSingleWon(won: number | null | undefined): string {
  if (won === null || won === undefined) return '-';
  if (won >= 100_000_000) {
    return `${(won / 100_000_000).toFixed(2)}억원`;
  }
  if (won >= 100_000) {
    return `${(won / 10_000).toFixed(1)}만원`;
  }
  return `${won.toLocaleString('ko-KR')}원`;
}

function getCongestionBadgeClass(level: string): string {
  switch (level) {
    case '붐빔':
      return 'border-red-200 bg-red-50 text-red-700';
    case '약간 붐빔':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case '보통':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    case '여유':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-600';
  }
}

function getCongestionBarColor(level: string): string {
  switch (level) {
    case '붐빔':
      return '#E11D48';
    case '약간 붐빔':
      return '#D97706';
    case '보통':
      return '#2563EB';
    case '여유':
      return '#059669';
    default:
      return '#64748B';
  }
}

function getCommercialBadgeClass(level: string): string {
  switch (level) {
    case '바쁜':
    case '분주한':
      return 'border-blue-300 bg-blue-50 text-blue-800';
    case '보통':
      return 'border-slate-300 bg-slate-50 text-slate-700';
    case '한산한':
      return 'border-slate-200 bg-slate-50 text-slate-500';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-600';
  }
}

function getTrafficTextClass(level: string): string {
  switch (level) {
    case '원활':
      return 'text-emerald-700';
    case '서행':
      return 'text-amber-700';
    case '정체':
      return 'text-red-700';
    default:
      return 'text-slate-900';
  }
}

export const SeoulCityDataPanel: React.FC<SeoulCityDataPanelProps> = ({
  data,
  centerLat,
  centerLng,
  loading,
  activeMapAreaCode,
  onShowAreaOnMap,
}) => {
  const [overrideData, setOverrideData] = useState<SeoulCityDataSummary | null>(
    null
  );
  const [switchingCode, setSwitchingCode] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [hoveredForecastIdx, setHoveredForecastIdx] = useState<number | null>(
    null
  );

  useEffect(() => {
    setOverrideData(null);
    setSwitchingCode(null);
    setSwitchError(null);
    setHoveredForecastIdx(null);
  }, [data]);

  const activeData = overrideData ?? data;

  const isMapShowingCurrent =
    Boolean(activeData?.areaCode) &&
    activeMapAreaCode === activeData?.areaCode;

  const handleHotspotClick = async (areaCode: string) => {
    if (!activeData || switchingCode) return;

    // Clicking the currently active hotspot toggles its polygon on KakaoMap
    if (activeData.areaCode === areaCode) {
      if (onShowAreaOnMap) {
        onShowAreaOnMap(isMapShowingCurrent ? null : activeData);
      }
      return;
    }

    if (!centerLat || !centerLng) return;

    setSwitchingCode(areaCode);
    setSwitchError(null);
    try {
      const qs = new URLSearchParams({
        lat: centerLat,
        lng: centerLng,
        areaCode,
      });
      const res = await fetch(`/api/seoul-citydata?${qs.toString()}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const next = (await res.json()) as SeoulCityDataSummary;
      setOverrideData(next);
      setHoveredForecastIdx(null);
      if (onShowAreaOnMap && next.areaPolygon && next.areaPolygon.length > 0) {
        onShowAreaOnMap(next);
      }
    } catch (err) {
      setSwitchError(
        err instanceof Error ? err.message : '거점 전환 조회 실패'
      );
    } finally {
      setSwitchingCode(null);
    }
  };

  const forecastPoints = useMemo(() => {
    const items = activeData?.forecast ?? [];
    return items.map((f) => {
      const mid =
        f.minPopulation !== null && f.maxPopulation !== null
          ? Math.round((f.minPopulation + f.maxPopulation) / 2)
          : f.minPopulation ?? f.maxPopulation ?? 0;
      return {
        ...f,
        midPopulation: mid,
      };
    });
  }, [activeData?.forecast]);

  if (loading) {
    return (
      <div className="border border-slate-200 bg-white">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="h-4 w-48 bg-slate-100 animate-pulse" />
          <div className="h-3 w-32 bg-slate-100 animate-pulse" />
        </div>
        <div className="p-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="space-y-2">
              <div className="h-3 w-20 bg-slate-100 animate-pulse" />
              <div className="h-5 w-28 bg-slate-100 animate-pulse" />
              <div className="h-3 w-24 bg-slate-100 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!activeData) {
    return null;
  }

  if (!activeData.configured) {
    return (
      <div className="border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 flex items-center justify-between gap-2">
        <span>
          서울시 실시간 도시데이터 — API 키(SEOUL_OPEN_DATA_API_KEY)가 설정되지
          않아 조회되지 않았습니다.
        </span>
      </div>
    );
  }

  if (!activeData.supported) {
    return (
      <div className="border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <span>
          서울시 실시간 도시데이터 — 서울 주요 거점(121곳) 반경 3.5km 외 지역으로
          실시간 거점 데이터가 제공되지 않습니다.
        </span>
        <span className="text-slate-400 shrink-0">서울 열린데이터 광장</span>
      </div>
    );
  }

  const maxFloatingAgeRate = Math.max(
    ...(activeData.ageRates.map((a) => a.rate) || [0]),
    1
  );
  const maxCommercialAgeRate = Math.max(
    ...(activeData.commercialAgeRates.map((a) => a.rate) || [0]),
    1
  );

  const shPaymentMid =
    activeData.shPaymentMinWon !== null && activeData.shPaymentMaxWon !== null
      ? Math.round((activeData.shPaymentMinWon + activeData.shPaymentMaxWon) / 2)
      : activeData.shPaymentMaxWon ?? activeData.shPaymentMinWon;
  const avgAreaSpendWon =
    shPaymentMid !== null &&
    activeData.shPaymentCount !== null &&
    activeData.shPaymentCount > 0
      ? Math.round(shPaymentMid / activeData.shPaymentCount)
      : null;

  const populationRangeLabel =
    activeData.populationMin !== null && activeData.populationMax !== null
      ? `${activeData.populationMin.toLocaleString('ko-KR')}~${activeData.populationMax.toLocaleString('ko-KR')}명`
      : '-';

  const topFloatingAge = activeData.ageRates.reduce<{
    label: string;
    rate: number;
  } | null>((best, cur) => (!best || cur.rate > best.rate ? cur : best), null);
  const topCommercialAge = activeData.commercialAgeRates.reduce<{
    label: string;
    rate: number;
  } | null>((best, cur) => (!best || cur.rate > best.rate ? cur : best), null);

  const maxForecastPop = Math.max(
    ...forecastPoints.map((p) => p.midPopulation),
    1
  );
  const activeForecastIdx =
    hoveredForecastIdx !== null && forecastPoints[hoveredForecastIdx]
      ? hoveredForecastIdx
      : 0;
  const activeForecastItem = forecastPoints[activeForecastIdx] ?? null;

  return (
    <div className="border border-slate-200 bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-900">
              서울시 실시간 도시데이터 · 상권 중심 분석
            </h3>
            {activeData.areaCategory && (
              <span className="px-1.5 py-0.5 text-[11px] font-medium border border-slate-300 bg-slate-50 text-slate-700 whitespace-nowrap">
                {activeData.areaCategory}
              </span>
            )}
            {activeData.commercialLevel && (
              <span
                className={`px-1.5 py-0.5 text-[11px] font-medium border whitespace-nowrap ${getCommercialBadgeClass(
                  activeData.commercialLevel
                )}`}
              >
                상권 {activeData.commercialLevel}
              </span>
            )}
            {activeData.congestLevel && (
              <span
                className={`px-1.5 py-0.5 text-[11px] font-medium border whitespace-nowrap ${getCongestionBadgeClass(
                  activeData.congestLevel
                )}`}
              >
                인구 {activeData.congestLevel}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            기준 거점: {activeData.areaName}
            {activeData.distanceMeters !== null
              ? ` · 중심점으로부터 ${activeData.distanceMeters.toLocaleString('ko-KR')}m`
              : ''}
            {activeData.commercialTime
              ? ` · 상권 ${activeData.commercialTime}`
              : activeData.populationTime
                ? ` · ${activeData.populationTime}`
                : ''}
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {activeData.areaPolygon.length > 0 && onShowAreaOnMap && (
            <button
              type="button"
              onClick={() =>
                onShowAreaOnMap(isMapShowingCurrent ? null : activeData)
              }
              className={`px-2.5 py-1 text-[11px] border inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                isMapShowingCurrent
                  ? 'border-rose-600 bg-rose-600 text-white font-medium'
                  : 'border-rose-300 bg-rose-50/70 text-rose-700 hover:bg-rose-100 font-medium'
              }`}
            >
              <MapPin className="w-3 h-3 shrink-0" />
              {isMapShowingCurrent ? '지도 상권 구역 해제' : '지도에 상권 구역 표시'}
            </button>
          )}
          {activeData.nearbyHotspots.map((hotspot) => {
            const isSelected = hotspot.code === activeData.areaCode;
            const isBusy = switchingCode === hotspot.code;
            return (
              <button
                key={hotspot.code}
                type="button"
                disabled={Boolean(switchingCode)}
                onClick={() => handleHotspotClick(hotspot.code)}
                title="클릭 시 해당 상권·거점 조회 및 카카오지도 상권 구역 표시"
                className={`px-2 py-1 text-[11px] border whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-slate-900 bg-slate-900 text-white font-medium'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                } ${switchingCode ? 'opacity-70' : ''}`}
              >
                {isBusy ? '조회 중...' : hotspot.name}{' '}
                <span
                  className={`font-mono tabular-nums ${
                    isSelected ? 'text-slate-300' : 'text-slate-400'
                  }`}
                >
                  ({(hotspot.distanceMeters / 1000).toFixed(1)}km)
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {(activeData.error || switchError) && (
        <div className="px-4 py-2 border-b border-slate-200 bg-red-50/50 text-xs text-red-600">
          {switchError || activeData.error}
        </div>
      )}

      {/* Row 1: 4-column Commercial-Focused Real-Time KPIs (Weather & Parking omitted for commercial focus) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200">
        <div className="px-4 py-3">
          <div className="text-[11px] text-slate-500">
            실시간 상권 활성도 · 결제규모
          </div>
          <div className="text-sm font-semibold text-blue-700 mt-1 font-mono tabular-nums">
            {formatWonRangeCompact(
              activeData.shPaymentMinWon,
              activeData.shPaymentMaxWon
            )}
            {activeData.commercialLevel ? (
              <span className="ml-1.5 text-xs font-sans font-semibold text-slate-900">
                ({activeData.commercialLevel})
              </span>
            ) : null}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
            {activeData.shPaymentCount !== null
              ? `신한카드 결제 ${activeData.shPaymentCount.toLocaleString('ko-KR')}건`
              : '-'}
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-[11px] text-slate-500">
            건당 평균 결제 · 결제 주체
          </div>
          <div className="text-sm font-semibold text-slate-900 mt-1 font-mono tabular-nums">
            {avgAreaSpendWon !== null ? formatSingleWon(avgAreaSpendWon) : '-'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
            {activeData.commercialPersonalRate !== null &&
            activeData.commercialCorporationRate !== null
              ? `개인 ${activeData.commercialPersonalRate}% · 법인 ${activeData.commercialCorporationRate}%`
              : '-'}
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-[11px] text-slate-500">
            실시간 유동인구 · 상주/유입
          </div>
          <div className="text-sm font-semibold text-slate-900 mt-1 font-mono tabular-nums">
            {populationRangeLabel}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
            {activeData.residentRate !== null &&
            activeData.nonResidentRate !== null
              ? `상주 ${activeData.residentRate}% · 유입 ${activeData.nonResidentRate}%`
              : '-'}
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-[11px] text-slate-500">주변 도로 소통</div>
          <div
            className={`text-sm font-semibold mt-1 tabular-nums ${getTrafficTextClass(
              activeData.roadTrafficLevel
            )}`}
          >
            {activeData.roadTrafficLevel || '-'}
            {activeData.roadTrafficSpeedKmh !== null && (
              <span className="ml-1.5 font-mono text-slate-700 font-medium text-xs">
                평균 {activeData.roadTrafficSpeedKmh}km/h
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 truncate">
            {activeData.roadTrafficMessage || '-'}
          </div>
        </div>
      </div>

      {/* Row 2: All Commercial Categories Ranked by Payment Amount */}
      <div className="p-4 border-b border-slate-200 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
          <h4 className="text-xs font-semibold text-slate-900">
            업종별 실시간 결제 현황 (결제금액 순 전체 {activeData.commercialCategories.length}개 업종)
          </h4>
          <span className="text-[11px] text-slate-400">
            평균 소비금액 = 결제금액 ÷ 결제건수 · 소비점수 = 총 결제금액(50%) + 가맹점당 결제효율(50%)
          </span>
        </div>

        {activeData.commercialCategories.length > 0 ? (
          <div className="border border-slate-200 overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <th className="py-2 px-3 text-center font-medium w-12">순위</th>
                  <th className="py-2 px-3 text-left font-medium">업종 (대분류 · 중분류)</th>
                  <th className="py-2 px-3 text-center font-medium w-20">결제수준</th>
                  <th className="py-2 px-3 text-right font-medium">결제금액</th>
                  <th className="py-2 px-3 text-right font-medium w-20">결제건수</th>
                  <th className="py-2 px-3 text-right font-medium">평균 소비금액</th>
                  <th className="py-2 px-3 text-right font-medium w-20">가맹점</th>
                  <th className="py-2 px-3 text-right font-medium w-32">소비점수</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeData.commercialCategories.map((cat, idx) => {
                  const score = cat.consumptionScore ?? 0;
                  return (
                    <tr
                      key={`${cat.largeCategory}-${cat.mediumCategory}-${idx}`}
                      className="hover:bg-slate-50/70"
                    >
                      <td className="py-2 px-3 text-center font-mono tabular-nums font-semibold text-slate-700">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-3">
                        <span className="text-[11px] text-slate-400 mr-1.5">
                          {cat.largeCategory}
                        </span>
                        <span className="font-medium text-slate-900">
                          {cat.mediumCategory}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        {cat.paymentLevel ? (
                          <span
                            className={`inline-block px-1.5 py-0.5 text-[11px] border whitespace-nowrap ${getCommercialBadgeClass(
                              cat.paymentLevel
                            )}`}
                          >
                            {cat.paymentLevel}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                        {formatWonRangeCompact(
                          cat.paymentAmountMinWon,
                          cat.paymentAmountMaxWon
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {cat.paymentCount !== null
                          ? `${cat.paymentCount.toLocaleString('ko-KR')}건`
                          : '-'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums font-medium text-blue-700 whitespace-nowrap">
                        {formatSingleWon(cat.avgSpendWon)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {cat.merchantCount !== null
                          ? `${cat.merchantCount.toLocaleString('ko-KR')}점`
                          : '-'}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {cat.consumptionScore !== null ? (
                          <div className="inline-flex items-center justify-end gap-2 w-full">
                            <div className="w-14 h-1.5 bg-slate-100 overflow-hidden shrink-0">
                              <div
                                className="h-full bg-blue-600"
                                style={{ width: `${Math.min(100, Math.max(4, score))}%` }}
                              />
                            </div>
                            <span className="font-mono tabular-nums font-semibold text-slate-900 w-9 text-right">
                              {score}점
                            </span>
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            업종별 실시간 결제 현황 데이터가 제공되지 않았습니다.
          </p>
        )}
      </div>

      {/* Row 3: Floating Population vs Real-Time Consumer Population Comparison */}
      <div className="grid grid-cols-1 xl:grid-cols-2 divide-y xl:divide-y-0 xl:divide-x divide-slate-200 border-b border-slate-200">
        {/* Left: Floating Population (Age + Gender) */}
        <div className="p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-xs font-semibold text-slate-900">
              연령대별 유동인구 분포 · 성별 비율
            </h4>
            <span className="text-[11px] text-slate-400">
              {topFloatingAge
                ? `최다 연령: ${topFloatingAge.label} (${topFloatingAge.rate}%)`
                : '실시간 위치 추계'}
            </span>
          </div>

          {activeData.maleRate !== null && activeData.femaleRate !== null && (
            <div className="space-y-1 bg-slate-50/70 border border-slate-200 px-3 py-2">
              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                <span className="text-blue-700 font-medium">
                  남성 {activeData.maleRate.toFixed(1)}%
                </span>
                <span className="text-slate-400 font-sans">유동인구 성비</span>
                <span className="text-rose-700 font-medium">
                  여성 {activeData.femaleRate.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 w-full bg-rose-500/80 overflow-hidden flex">
                <div
                  className="h-full bg-blue-600"
                  style={{ width: `${Math.max(0, Math.min(100, activeData.maleRate))}%` }}
                />
              </div>
            </div>
          )}

          {activeData.ageRates.length > 0 ? (
            <div className="space-y-1.5">
              {activeData.ageRates.map((age) => {
                const widthPct = Math.max(
                  4,
                  Math.min(100, (age.rate / maxFloatingAgeRate) * 100)
                );
                return (
                  <div
                    key={age.label}
                    className="grid grid-cols-12 items-center gap-2 text-xs"
                  >
                    <span className="col-span-2 text-slate-600 font-medium">
                      {age.label}
                    </span>
                    <div className="col-span-8 h-2 bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-slate-800"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="col-span-2 text-right font-mono tabular-nums text-slate-800 font-medium">
                      {age.rate.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              유동인구 연령대 분포 데이터가 제공되지 않았습니다.
            </p>
          )}
        </div>

        {/* Right: Commercial Consumer Population (Age + Gender) */}
        <div className="p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-xs font-semibold text-slate-900">
              실시간 소비인구 분포 · 성별 비율
            </h4>
            <span className="text-[11px] text-blue-700 font-medium">
              {topCommercialAge
                ? `주 소비층: ${topCommercialAge.label} (${topCommercialAge.rate}%)`
                : '신한카드 실시간 결제 기준'}
            </span>
          </div>

          {activeData.commercialMaleRate !== null &&
            activeData.commercialFemaleRate !== null && (
              <div className="space-y-1 bg-slate-50/70 border border-slate-200 px-3 py-2">
                <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                  <span className="text-blue-700 font-medium">
                    남성 {activeData.commercialMaleRate.toFixed(1)}%
                  </span>
                  <span className="text-slate-400 font-sans">소비인구 성비</span>
                  <span className="text-rose-700 font-medium">
                    여성 {activeData.commercialFemaleRate.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 w-full bg-rose-500/80 overflow-hidden flex">
                  <div
                    className="h-full bg-blue-600"
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(100, activeData.commercialMaleRate)
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}

          {activeData.commercialAgeRates.length > 0 ? (
            <div className="space-y-1.5">
              {activeData.commercialAgeRates.map((age) => {
                const widthPct = Math.max(
                  4,
                  Math.min(100, (age.rate / maxCommercialAgeRate) * 100)
                );
                return (
                  <div
                    key={age.label}
                    className="grid grid-cols-12 items-center gap-2 text-xs"
                  >
                    <span className="col-span-2 text-slate-600 font-medium">
                      {age.label}
                    </span>
                    <div className="col-span-8 h-2 bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-blue-600"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="col-span-2 text-right font-mono tabular-nums text-slate-800 font-medium">
                      {age.rate.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              실시간 소비인구 연령·성별 데이터가 제공되지 않았습니다.
            </p>
          )}
        </div>
      </div>

      {/* Row 4: Full Hourly Congestion Forecast Graph (All API-provided hourly slots: 12h) */}
      <div className="p-4 border-b border-slate-200 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-semibold text-slate-900">
              향후 시간대별 혼잡 예측 그래프 (서울시 API 제공 {forecastPoints.length}시간)
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              서울시 실시간 도시데이터 API는 향후 12시간 정시 예측을 제공합니다. 막대에 마우스를 올리거나 클릭해 상세 인구를 확인하세요.
            </p>
          </div>
          {activeForecastItem && (
            <div className="flex items-center gap-2 border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-mono tabular-nums shrink-0">
              <span className="font-semibold text-slate-900">
                {activeForecastItem.timeLabel}
              </span>
              <span
                className={`px-1.5 py-0.5 text-[10px] font-sans font-medium border ${getCongestionBadgeClass(
                  activeForecastItem.congestLevel
                )}`}
              >
                {activeForecastItem.congestLevel || '-'}
              </span>
              <span className="text-slate-700">
                {activeForecastItem.minPopulation !== null &&
                activeForecastItem.maxPopulation !== null
                  ? `${activeForecastItem.minPopulation.toLocaleString('ko-KR')}~${activeForecastItem.maxPopulation.toLocaleString('ko-KR')}명`
                  : `${activeForecastItem.midPopulation.toLocaleString('ko-KR')}명`}
              </span>
            </div>
          )}
        </div>

        {forecastPoints.length > 0 ? (
          <div className="border border-slate-200 bg-slate-50/40 p-3">
            <div
              className="grid gap-1.5 items-end h-40 pt-5"
              style={{
                gridTemplateColumns: `repeat(${forecastPoints.length}, minmax(0, 1fr))`,
              }}
            >
              {forecastPoints.map((pt, idx) => {
                const heightPct = Math.max(
                  8,
                  Math.round((pt.midPopulation / maxForecastPop) * 100)
                );
                const isSelected = idx === activeForecastIdx;
                const barColor = getCongestionBarColor(pt.congestLevel);
                return (
                  <button
                    key={`${pt.timeLabel}-${idx}`}
                    type="button"
                    onMouseEnter={() => setHoveredForecastIdx(idx)}
                    onFocus={() => setHoveredForecastIdx(idx)}
                    onClick={() => setHoveredForecastIdx(idx)}
                    className="h-full flex flex-col items-center justify-end group cursor-pointer focus:outline-none"
                  >
                    <span className="text-[10px] font-mono tabular-nums text-slate-600 mb-1 whitespace-nowrap">
                      {pt.midPopulation >= 1000
                        ? `${(pt.midPopulation / 1000).toFixed(1)}k`
                        : pt.midPopulation}
                    </span>
                    <div
                      className={`w-full max-w-[34px] transition-all ${
                        isSelected
                          ? 'ring-2 ring-slate-900 ring-offset-1'
                          : 'opacity-90 group-hover:opacity-100'
                      }`}
                      style={{
                        height: `${heightPct}%`,
                        backgroundColor: barColor,
                      }}
                    />
                  </button>
                );
              })}
            </div>

            <div
              className="grid gap-1.5 mt-2 pt-2 border-t border-slate-200"
              style={{
                gridTemplateColumns: `repeat(${forecastPoints.length}, minmax(0, 1fr))`,
              }}
            >
              {forecastPoints.map((pt, idx) => (
                <div
                  key={`lbl-${pt.timeLabel}-${idx}`}
                  className="text-center"
                >
                  <div
                    className={`text-[11px] font-mono tabular-nums ${
                      idx === activeForecastIdx
                        ? 'font-semibold text-slate-900'
                        : 'text-slate-500'
                    }`}
                  >
                    {pt.timeLabel}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate mt-0.5">
                    {pt.congestLevel}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-end gap-3 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 bg-[#059669] inline-block" />
                여유
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 bg-[#2563EB] inline-block" />
                보통
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 bg-[#D97706] inline-block" />
                약간 붐빔
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 bg-[#E11D48] inline-block" />
                붐빔
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            향후 시간대별 혼잡 예측 데이터가 제공되지 않았습니다.
          </p>
        )}
      </div>

      {/* Row 5: Real-Time Transit Boarding/Alighting Visualization (Subway & Bus) */}
      <TransitFlowSection transit={activeData.transit} />
    </div>
  );
};

const TransitModeCard: React.FC<{
  title: string;
  countLabel: string;
  stations?: Array<{ name: string; line: string }>;
  intervals: SeoulTransitIntervalStat[];
}> = ({ title, countLabel, stations, intervals }) => {
  const cumulative = intervals.find((i) => i.label === '당일 누적') ?? null;
  const recentIntervals = intervals.filter((i) => i.label !== '당일 누적');

  const cumBoard = cumulative
    ? getIntervalMid(cumulative.boardMin, cumulative.boardMax)
    : 0;
  const cumAlight = cumulative
    ? getIntervalMid(cumulative.alightMin, cumulative.alightMax)
    : 0;
  const cumTotal = cumBoard + cumAlight;
  const boardPct = cumTotal > 0 ? (cumBoard / cumTotal) * 100 : 50;
  const netInflow = cumAlight - cumBoard;

  const maxRecent = Math.max(
    ...recentIntervals.flatMap((i) => [
      getIntervalMid(i.boardMin, i.boardMax),
      getIntervalMid(i.alightMin, i.alightMax),
    ]),
    1
  );

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h5 className="text-xs font-semibold text-slate-900">{title}</h5>
          {countLabel && (
            <span className="px-1.5 py-0.5 text-[10px] font-mono tabular-nums border border-slate-200 bg-slate-50 text-slate-600">
              {countLabel}
            </span>
          )}
        </div>
        {cumulative && cumTotal > 0 && (
          <span
            className={`text-[11px] font-mono tabular-nums font-medium ${
              netInflow >= 0 ? 'text-emerald-700' : 'text-blue-700'
            }`}
          >
            {netInflow >= 0
              ? `하차(유입) +${netInflow.toLocaleString('ko-KR')}명 우세`
              : `승차(유출) +${Math.abs(netInflow).toLocaleString('ko-KR')}명 우세`}
          </span>
        )}
      </div>

      {stations && stations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {stations.map((s) => (
            <span
              key={`${s.name}-${s.line}`}
              className="px-1.5 py-0.5 text-[11px] border border-slate-200 bg-white text-slate-700"
            >
              {s.name}{' '}
              {s.line ? (
                <span className="text-slate-400">({s.line}호선)</span>
              ) : null}
            </span>
          ))}
        </div>
      )}

      {cumulative ? (
        <div className="border border-slate-200 bg-slate-50/70 px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-mono tabular-nums text-blue-700 font-medium">
              당일 승차 {formatPeopleRange(cumulative.boardMin, cumulative.boardMax)} (
              {boardPct.toFixed(1)}%)
            </span>
            <span className="font-mono tabular-nums text-emerald-700 font-medium">
              하차 {formatPeopleRange(cumulative.alightMin, cumulative.alightMax)} (
              {(100 - boardPct).toFixed(1)}%)
            </span>
          </div>
          <div className="h-2.5 w-full bg-emerald-600 overflow-hidden flex">
            <div
              className="h-full bg-blue-600"
              style={{ width: `${Math.max(2, Math.min(98, boardPct))}%` }}
            />
          </div>
        </div>
      ) : null}

      {recentIntervals.length > 0 ? (
        <div className="space-y-2.5 pt-1">
          {recentIntervals.map((item) => {
            const bMid = getIntervalMid(item.boardMin, item.boardMax);
            const aMid = getIntervalMid(item.alightMin, item.alightMax);
            const bWidth = bMid > 0 ? Math.max(4, (bMid / maxRecent) * 100) : 0;
            const aWidth = aMid > 0 ? Math.max(4, (aMid / maxRecent) * 100) : 0;
            return (
              <div key={item.label} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-slate-700">{item.label}</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    승차 {formatPeopleRange(item.boardMin, item.boardMax)} · 하차{' '}
                    {formatPeopleRange(item.alightMin, item.alightMax)}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-7 text-[10px] text-blue-700 font-medium shrink-0">
                      승차
                    </span>
                    <div className="flex-1 h-2 bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-blue-600"
                        style={{ width: `${bWidth}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-7 text-[10px] text-emerald-700 font-medium shrink-0">
                      하차
                    </span>
                    <div className="flex-1 h-2 bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-emerald-600"
                        style={{ width: `${aWidth}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        !cumulative && (
          <p className="text-xs text-slate-400">
            실시간 승하차 데이터가 제공되지 않았습니다.
          </p>
        )
      )}
    </div>
  );
};

const TransitFlowSection: React.FC<{
  transit: SeoulCityDataSummary['transit'];
}> = ({ transit }) => {
  if (!transit) {
    return (
      <div className="p-4">
        <h4 className="text-xs font-semibold text-slate-900">
          대중교통 실시간 승하차 현황 (지하철 · 버스)
        </h4>
        <p className="text-xs text-slate-400 mt-1">
          해당 거점의 대중교통 실시간 승하차 데이터가 제공되지 않았습니다.
        </p>
      </div>
    );
  }

  const subCum = transit.subwayIntervals.find((i) => i.label === '당일 누적');
  const busCum = transit.busIntervals.find((i) => i.label === '당일 누적');
  const totalBoardMid =
    (subCum ? getIntervalMid(subCum.boardMin, subCum.boardMax) : 0) +
    (busCum ? getIntervalMid(busCum.boardMin, busCum.boardMax) : 0);
  const totalAlightMid =
    (subCum ? getIntervalMid(subCum.alightMin, subCum.alightMax) : 0) +
    (busCum ? getIntervalMid(busCum.alightMin, busCum.alightMax) : 0);
  const totalNetInflow = totalAlightMid - totalBoardMid;

  return (
    <div className="divide-y divide-slate-200">
      <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50/40">
        <div>
          <h4 className="text-xs font-semibold text-slate-900">
            대중교통 실시간 승하차 현황 (지하철 · 버스)
          </h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            거점 연계 지하철역·버스정류장의 당일 누적 및 최근 30분·10분·5분 실시간 승하차 흐름입니다.
          </p>
        </div>
        {(totalBoardMid > 0 || totalAlightMid > 0) && (
          <div className="flex items-center gap-3 text-xs font-mono tabular-nums shrink-0 border border-slate-200 bg-white px-3 py-1.5">
            <span className="text-blue-700">
              총 승차 ~{totalBoardMid.toLocaleString('ko-KR')}명
            </span>
            <span className="text-slate-300">|</span>
            <span className="text-emerald-700">
              총 하차 ~{totalAlightMid.toLocaleString('ko-KR')}명
            </span>
            <span className="text-slate-300">|</span>
            <span
              className={`font-semibold ${
                totalNetInflow >= 0 ? 'text-emerald-700' : 'text-blue-700'
              }`}
            >
              순유입 {totalNetInflow >= 0 ? '+' : ''}
              {totalNetInflow.toLocaleString('ko-KR')}명
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
        <TransitModeCard
          title="지하철 실시간 승하차"
          countLabel={
            transit.subwayStationCount !== null
              ? `대상 역 ${transit.subwayStationCount}개`
              : ''
          }
          stations={transit.subwayStations}
          intervals={transit.subwayIntervals}
        />
        <TransitModeCard
          title="버스 실시간 승하차"
          countLabel={
            transit.busStationCount !== null
              ? `대상 정류장 ${transit.busStationCount}개`
              : ''
          }
          intervals={transit.busIntervals}
        />
      </div>
    </div>
  );
};

