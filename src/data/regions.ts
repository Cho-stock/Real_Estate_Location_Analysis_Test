export interface SggOption {
  sggCode: string;
  name: string;
  defaultLat: string;
  defaultLng: string;
}

export interface SidoOption {
  sidoCode: string;
  name: string;
  districts: SggOption[];
}

export const SIDO_NAMES_BY_CODE: Record<string, string> = {
  '11': '서울특별시',
  '26': '부산광역시',
  '27': '대구광역시',
  '28': '인천광역시',
  '29': '광주광역시',
  '30': '대전광역시',
  '31': '울산광역시',
  '36': '세종특별자치시',
  '41': '경기도',
  '43': '충청북도',
  '44': '충청남도',
  '46': '전라남도',
  '47': '경상북도',
  '48': '경상남도',
  '50': '제주특별자치도',
  '51': '강원특별자치도',
  '52': '전북특별자치도',
};

export const KOREA_REGIONS: SidoOption[] = [
  {
    sidoCode: '11',
    name: '서울특별시',
    districts: [
      { sggCode: '11680', name: '강남구', defaultLat: '37.5172', defaultLng: '127.0473' },
      { sggCode: '11650', name: '서초구', defaultLat: '37.4837', defaultLng: '127.0324' },
      { sggCode: '11710', name: '송파구', defaultLat: '37.5145', defaultLng: '127.1059' },
      { sggCode: '11440', name: '마포구', defaultLat: '37.5663', defaultLng: '126.9014' },
      { sggCode: '11200', name: '성동구', defaultLat: '37.5633', defaultLng: '127.0371' },
      { sggCode: '11170', name: '용산구', defaultLat: '37.5326', defaultLng: '126.9905' },
      { sggCode: '11560', name: '영등포구', defaultLat: '37.5264', defaultLng: '126.8962' },
      { sggCode: '11110', name: '종로구', defaultLat: '37.5730', defaultLng: '126.9794' },
      { sggCode: '11140', name: '중구', defaultLat: '37.5641', defaultLng: '126.9979' },
      { sggCode: '11350', name: '노원구', defaultLat: '37.6542', defaultLng: '127.0568' },
      { sggCode: '11470', name: '양천구', defaultLat: '37.5170', defaultLng: '126.8664' },
      { sggCode: '11500', name: '강서구', defaultLat: '37.5509', defaultLng: '126.8495' },
    ],
  },
  {
    sidoCode: '41',
    name: '경기도',
    districts: [
      { sggCode: '41135', name: '성남시 분당구', defaultLat: '37.3827', defaultLng: '127.1189' },
      { sggCode: '41117', name: '수원시 영통구', defaultLat: '37.2596', defaultLng: '127.0465' },
      { sggCode: '41465', name: '용인시 수지구', defaultLat: '37.3222', defaultLng: '127.0977' },
      { sggCode: '41463', name: '용인시 기흥구', defaultLat: '37.2802', defaultLng: '127.1149' },
      { sggCode: '41285', name: '고양시 일산동구', defaultLat: '37.6584', defaultLng: '126.7749' },
      { sggCode: '41192', name: '부천시 원미구', defaultLat: '37.5035', defaultLng: '126.7660' },
      { sggCode: '41173', name: '안양시 동안구', defaultLat: '37.3924', defaultLng: '126.9511' },
      { sggCode: '41210', name: '광명시', defaultLat: '37.4786', defaultLng: '126.8643' },
      { sggCode: '41450', name: '하남시', defaultLat: '37.5393', defaultLng: '127.2148' },
      { sggCode: '41597', name: '화성시 동탄구', defaultLat: '37.2003', defaultLng: '127.0764' },
      { sggCode: '41590', name: '화성시', defaultLat: '37.1995', defaultLng: '126.8312' },
    ],
  },
  {
    sidoCode: '28',
    name: '인천광역시',
    districts: [
      { sggCode: '28185', name: '연수구', defaultLat: '37.4102', defaultLng: '126.6783' },
      { sggCode: '28260', name: '서구', defaultLat: '37.5454', defaultLng: '126.6760' },
      { sggCode: '28200', name: '남동구', defaultLat: '37.4472', defaultLng: '126.7315' },
    ],
  },
  {
    sidoCode: '26',
    name: '부산광역시',
    districts: [
      { sggCode: '26350', name: '해운대구', defaultLat: '35.1631', defaultLng: '129.1636' },
      { sggCode: '26500', name: '수영구', defaultLat: '35.1456', defaultLng: '129.1131' },
      { sggCode: '26230', name: '부산진구', defaultLat: '35.1630', defaultLng: '129.0532' },
    ],
  },
  {
    sidoCode: '27',
    name: '대구광역시',
    districts: [
      { sggCode: '27260', name: '수성구', defaultLat: '35.8581', defaultLng: '128.6306' },
      { sggCode: '27110', name: '중구', defaultLat: '35.8693', defaultLng: '128.6062' },
    ],
  },
  {
    sidoCode: '30',
    name: '대전광역시',
    districts: [
      { sggCode: '30200', name: '유성구', defaultLat: '36.3623', defaultLng: '127.3561' },
      { sggCode: '30170', name: '서구', defaultLat: '36.3554', defaultLng: '127.3837' },
    ],
  },
];

export function findRegionBySggCode(
  sggCode: string
): { sido: SidoOption; district: SggOption } | null {
  for (const sido of KOREA_REGIONS) {
    const district = sido.districts.find((d) => d.sggCode === sggCode);
    if (district) {
      return { sido, district };
    }
  }
  return null;
}

export const RADIUS_OPTIONS = [
  { value: 300, label: '300m' },
  { value: 500, label: '500m' },
  { value: 1000, label: '1,000m' },
  { value: 2000, label: '2,000m' },
];

export const SCHOOL_KIND_OPTIONS = [
  { code: '', label: '전체 학교급' },
  { code: '02', label: '초등학교' },
  { code: '03', label: '중학교' },
  { code: '04', label: '고등학교' },
];
