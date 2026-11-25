export type AnalysisTab =
  | 'overview'
  | 'schools'
  | 'commercial'
  | 'transactions'
  | 'reb'
  | 'specs';

export type PropertyType =
  | 'apt'
  | 'aptRent'
  | 'officetel'
  | 'officetelRent'
  | 'rowhouse'
  | 'rowhouseRent'
  | 'detached'
  | 'detachedRent'
  | 'commercial'
  | 'land';

export interface LocationQueryParams {
  sidoCode: string;
  sggCode: string;
  dongCode: string;
  dongName: string;
  complexName: string;
  lat: string;
  lng: string;
  radius: number;
  dealYmd: string;
  propertyType: PropertyType;
  schulKndCode: string;
  manualCoords?: boolean;
}

export interface ComplexOption {
  name: string;
  dongName: string;
  jibun: string;
  roadAddress: string;
  type: 'apt' | 'officetel';
}

export interface RegionOptionsResponse {
  dongs: string[];
  complexes: ComplexOption[];
}

export interface ResolvedLocationInfo {
  label: string;
  sidoName?: string;
  sggName?: string;
  dongName: string;
  complexName: string;
  lat: number | null;
  lng: number | null;
  resolutionSource: string;
}

export interface SchoolRecord {
  id: string;
  name: string;
  kindCode: string;
  kindName: string;
  foundationType: string;
  coedType: string;
  address: string;
  lat: number | null;
  lng: number | null;
  studentCount: number | null;
  teacherCount: number | null;
  distanceMeters: number | null;
}

export interface SchoolKindStat {
  kindName: string;
  count: number;
  ratio: number;
}

export interface SchoolSummary {
  totalSchools: number;
  elementaryCount: number;
  middleCount: number;
  highCount: number;
  otherCount: number;
  totalStudents: number | null;
  totalTeachers: number | null;
  studentsPerTeacher: number | null;
  kindDistribution: SchoolKindStat[];
}

export interface CommercialStoreRecord {
  id: string;
  name: string;
  branchName: string;
  largeCategoryCode: string;
  largeCategoryName: string;
  mediumCategoryName: string;
  smallCategoryName: string;
  roadAddress: string;
  lotAddress: string;
  dongName: string;
  floor: string;
  lat: number | null;
  lng: number | null;
  distanceMeters: number | null;
}

export interface CategoryStat {
  categoryName: string;
  count: number;
  ratio: number;
}

export interface FloorStat {
  label: string;
  count: number;
  ratio: number;
}

export interface CommercialSummary {
  totalStores: number;
  densityPerSqKm: number | null;
  firstFloorCount: number;
  firstFloorRatio: number | null;
  topCategoryName: string | null;
  topCategoryRatio: number | null;
  categoryDistribution: CategoryStat[];
  floorDistribution: FloorStat[];
}

export interface SubwayStationRecord {
  id: string;
  name: string;
  lineOrOperator: string;
  address: string;
  lat: number | null;
  lng: number | null;
  distanceMeters: number | null;
}

export interface BusStopRecord {
  id: string;
  name: string;
  routes: string;
  address: string;
  lat: number | null;
  lng: number | null;
  distanceMeters: number | null;
}

export interface HospitalRecord {
  id: string;
  name: string;
  category: '대학병원' | '종합병원';
  address: string;
  lat: number | null;
  lng: number | null;
  distanceMeters: number | null;
}

export interface TransactionRecord {
  id: string;
  propertyName: string;
  dongName: string;
  jibun: string;
  roadAddress: string;
  areaSqm: number | null;
  plottageAreaSqm: number | null;
  priceMan: number | null;
  monthlyRentMan: number | null;
  pricePerSqmMan: number | null;
  dealDate: string;
  floor: string;
  buildYear: string;
  buildingUse: string;
  jimok: string;
  landUse: string;
  contractType: string;
}

export interface TransactionSummary {
  totalTransactions: number;
  avgPriceMan: number | null;
  medianPriceMan: number | null;
  avgMonthlyRentMan: number | null;
  avgAreaSqm: number | null;
  avgPricePerSqmMan: number | null;
  minPriceMan: number | null;
  maxPriceMan: number | null;
}

export interface RebStatRecord {
  id: string;
  statTableId: string;
  statTableName: string;
  regionName: string;
  regionFullName: string;
  itemName: string;
  periodCode: string;
  periodLabel: string;
  value: number | null;
  unit: string;
}

export interface RebSummary {
  landPriceIndex: number | null;
  landPriceIndexPeriod: string | null;
  landChangeRate: number | null;
  landChangeRatePeriod: string | null;
  aptSaleIndex: number | null;
  aptSaleIndexPeriod: string | null;
  aptJeonseIndex: number | null;
  aptJeonseIndexPeriod: string | null;
  matchedRegionLabel: string | null;
}

export interface BuildingLedgerSummary {
  pnuLabel: string;
  roadAddress: string;
  buildingName: string;
  regstrKindName: string;
  mainPurpose: string;
  structure: string;
  zoning: string;
  platAreaSqm: number | null;
  archAreaSqm: number | null;
  totAreaSqm: number | null;
  bcRatPct: number | null;
  vlRatPct: number | null;
  householdCount: number | null;
  hoCount: number | null;
  mainBuildingCount: number | null;
  maxGroundFloors: number | null;
  maxUndergroundFloors: number | null;
  totalParkingCount: number | null;
  parkingPerHousehold: number | null;
  elevatorCount: number | null;
  useApprovalDate: string;
  buildingAgeYears: number | null;
  seismicDesignApplied: boolean | null;
  greenBuildingGrade: string;
  violationFlag: boolean | null;
}

export interface ClosedBuildingRecord {
  id: string;
  buildingName: string;
  lotAddress: string;
  regstrKindName: string;
  closureTypeName: string;
  closureDate: string;
  mainPurpose: string;
  structure: string;
  totAreaSqm: number | null;
  floorsLabel: string;
  useApprovalDate: string;
}

export interface BuildingRegisterResult {
  configured: boolean;
  error: string | null;
  sigunguCd: string;
  bjdongCd: string;
  bun: string;
  ji: string;
  closedScope: 'parcel' | 'dong' | 'none';
  summary: BuildingLedgerSummary | null;
  closedRecords: ClosedBuildingRecord[];
}

export interface SeoulCityDataCategoryStat {
  largeCategory: string;
  mediumCategory: string;
  paymentLevel: string;
  paymentCount: number | null;
  paymentAmountMinWon: number | null;
  paymentAmountMaxWon: number | null;
  paymentAmountMidWon: number | null;
  avgSpendWon: number | null;
  merchantCount: number | null;
  spendPerMerchantWon: number | null;
  consumptionScore: number | null;
}

export interface SeoulCityDataForecastItem {
  timeLabel: string;
  congestLevel: string;
  minPopulation: number | null;
  maxPopulation: number | null;
}

export interface SeoulParkingStatusItem {
  name: string;
  address: string;
  capacity: number | null;
  currentCount: number | null;
  availableCount: number | null;
  payYn: string;
  baseRateWon: number | null;
  baseTimeMin: number | null;
  realtimeProvided: boolean;
}

export interface SeoulTransitIntervalStat {
  label: string;
  boardMin: number | null;
  boardMax: number | null;
  alightMin: number | null;
  alightMax: number | null;
}

export interface SeoulTransitSummary {
  subwayStationCount: number | null;
  subwayStations: Array<{ name: string; line: string }>;
  subwayIntervals: SeoulTransitIntervalStat[];
  busStationCount: number | null;
  busIntervals: SeoulTransitIntervalStat[];
}

export interface SeoulCityDataSummary {
  configured: boolean;
  supported: boolean;
  areaCode: string;
  areaName: string;
  areaCategory: string;
  areaPolygon: Array<Array<[number, number]>>;
  distanceMeters: number | null;
  nearbyHotspots: Array<{ code: string; name: string; distanceMeters: number }>;
  error: string | null;
  congestLevel: string;
  congestMessage: string;
  populationMin: number | null;
  populationMax: number | null;
  maleRate: number | null;
  femaleRate: number | null;
  residentRate: number | null;
  nonResidentRate: number | null;
  ageRates: Array<{ label: string; rate: number }>;
  populationTime: string;
  forecast: SeoulCityDataForecastItem[];
  commercialLevel: string;
  commercialTime: string;
  shPaymentCount: number | null;
  shPaymentMinWon: number | null;
  shPaymentMaxWon: number | null;
  commercialMaleRate: number | null;
  commercialFemaleRate: number | null;
  commercialAgeRates: Array<{ label: string; rate: number }>;
  commercialPersonalRate: number | null;
  commercialCorporationRate: number | null;
  commercialCategories: SeoulCityDataCategoryStat[];
  transit: SeoulTransitSummary | null;
  roadTrafficLevel: string;
  roadTrafficSpeedKmh: number | null;
  roadTrafficMessage: string;
  temperatureC: number | null;
  pm10: number | null;
  pm10Index: string;
  pm25: number | null;
  pm25Index: string;
  airIndex: string;
  parkingTotalCount: number;
  parkingLots: SeoulParkingStatusItem[];
}

export interface DatasetResult<TItem, TSummary> {
  configured: boolean;
  fetched: boolean;
  envVarName: string;
  sourceName: string;
  items: TItem[];
  summary: TSummary | null;
  error: string | null;
}

export interface AnalysisResponse {
  queriedAt: string;
  params: LocationQueryParams;
  resolvedLocation: ResolvedLocationInfo;
  schools: DatasetResult<SchoolRecord, SchoolSummary>;
  commercial: DatasetResult<CommercialStoreRecord, CommercialSummary>;
  subways: SubwayStationRecord[];
  busStops: BusStopRecord[];
  hospitals: HospitalRecord[];
  buildingRegister: BuildingRegisterResult;
  seoulCityData: SeoulCityDataSummary;
  transactions: DatasetResult<TransactionRecord, TransactionSummary>;
  reb: DatasetResult<RebStatRecord, RebSummary>;
}

export interface ApiSourceSpec {
  id: string;
  name: string;
  provider: string;
  envVar: string;
  configured: boolean;
  endpoint: string;
  requiredParams: string[];
  outputFields: string[];
}

export interface SearchPlaceCandidate {
  id: string;
  placeName: string;
  categoryName: string;
  roadAddress: string;
  lotAddress: string;
  zipNo: string;
  sidoCode?: string;
  sggCode?: string;
  sidoName?: string;
  sggName?: string;
  dongName?: string;
  lat: number;
  lng: number;
  source: 'address' | 'keyword';
}

export interface GeocodeResult {
  configured: boolean;
  found: boolean;
  query: string;
  address: string;
  roadAddress?: string;
  lotAddress?: string;
  zipNo?: string;
  sidoCode?: string;
  sggCode?: string;
  sidoName?: string;
  sggName?: string;
  dongName?: string;
  candidates?: SearchPlaceCandidate[];
  totalCount?: number;
  pageableCount?: number;
  page?: number;
  isEnd?: boolean;
  lat: number | null;
  lng: number | null;
  error: string | null;
}

export interface MapConfigResponse {
  configured: boolean;
  jsKey: string | null;
}
