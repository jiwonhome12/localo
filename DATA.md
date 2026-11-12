# 수집 데이터 연결

`localo.json`은 팀 수집 시트의 신청·환급 25개 지역과 식당 125곳(음식점 100곳, 카페·베이커리 25곳)을 담습니다. 예시 행과 안내 문구는 제외했습니다. 각 레코드의 `fields`는 엑셀 열 이름과 원문 값을 보존하며 `sourceRow`로 원본 행을 찾을 수 있습니다.

## UI에서 사용

정적 서버로 저장소를 제공하고 HTML의 모듈 스크립트에서 다음처럼 불러옵니다.

```html
<script type="module">
  import { loadLocaloData, getRegionData } from './localo-data.js';
  const data = await loadLocaloData();
  const { region, places } = getRegionData(data, '거창군');
  console.log(region.fields, places);
</script>
```

지역명으로 신청 안내와 장소 목록을 연결합니다. 현재 저장소에는 UI 원본이 없어 화면 렌더링 연동은 대기 중입니다. Claude 아티팩트의 HTML/소스를 추가한 뒤 기존 지역 선택·장소 카드에 위 데이터를 전달해야 합니다.

## 데이터 갱신

Python에 `openpyxl`을 설치한 뒤 실행합니다.

```sh
python import_workbook.py "반값여행 25개 지자체 팀 수집 시트.xlsx"
```

신청 상태 확인일은 원본의 2026-11-05입니다. 식당 가맹 여부는 모두 미확인이며 좌표·가격 단위·가격 확인일은 null로 보존합니다. 원문 금액과 숫자 칸이 충돌하는 항목도 원문 그대로 포함합니다. 강진군 최소 소비 금액 설명과 숫자 칸 등이 이에 해당합니다. 환급 계산 구현 시 유형별 조건과 가맹 여부를 확인해야 합니다.

