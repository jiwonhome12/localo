# 수집 데이터 연결

**흐름:** 팀 수집 시트 → `localo.json`(원문 그대로) → `data/regions.json`, `data/places.json`(화면용) → 앱

| 파일 | 내용 | 만드는 방법 |
| --- | --- | --- |
| `localo.json` | 시트 '신청·환급' 25곳, '식당' 125곳. 열 이름과 원문 값을 그대로 보존 | `scripts/sync_sheet.py` |
| `data/regions.json` | 지역 신청 상태, 신청 안내, 환급 규칙 | `scripts/build_data.py` |
| `data/places.json` | 식당·카페는 실데이터, 숙박·관광지는 아직 예시(`sample: true`) | `scripts/build_data.py` |
| `data/geocode-cache.json` | 카카오 로컬 API로 찾은 식당 좌표 | `scripts/geocode.py` |
| `data/region-extras.json` | 관광주민증 혜택(★), 상·하반기 구분. 시트에 없는 시제품 값이라 확인 필요 | 직접 수정 |
| `data/geo.json` | 통계청 행정구역 경계(지도) | — |
| `data/places.sample.json` | 화면 설계용 예시 장소. 숙박·관광지만 계속 사용 | — |

## 자동 동기화 (GitHub Actions)

`.github/workflows/sync-data.yml`이 매일 06:07(한국 시간)에 돌고, Actions 탭에서 바로 실행할 수도 있어요. 데이터가 바뀌었을 때만 커밋하고, 검증에 실패하면 커밋하지 않아 사이트는 마지막 정상 데이터를 유지해요.

레포 Settings → Secrets and variables → Actions에 등록할 값:

| 이름 | 값 | 없으면 |
| --- | --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 서비스 계정 JSON 키 파일 내용 전체. 수집 시트를 서비스 계정 이메일에 '뷰어'로 공유 | 시트 읽기를 건너뛰고 지금 `localo.json`으로 만듦 |
| `KAKAO_REST_API_KEY` | 카카오 개발자 REST API 키 | 식당을 지역 안 근사 위치에 표시 |

## 직접 실행

```sh
pip install -r scripts/requirements.txt
python scripts/sync_sheet.py --api            # 시트에서 바로 (서비스 계정 키 필요)
python scripts/sync_sheet.py --xlsx 시트.xlsx  # 내려받은 엑셀로 (python import_workbook.py 시트.xlsx 도 동작)
python scripts/geocode.py                     # 선택, KAKAO_REST_API_KEY 필요
python scripts/build_data.py                  # 화면 데이터 만들기·검증
```

## 변환 규칙

- **지역 연결:** 시트 시군구코드(예: 평창 51760)와 지도 코드(32370)는 체계가 달라, 시도 + 지자체 이름으로 매칭해요.
- **신청 상태:** 신청접수중·준비중·마감 → `open`·`soon`·`closed`. 다른 값이면 빌드가 실패해요.
- **업종:** 음식점 → `food`, 카페·베이커리 → `cafe`. 다른 값이면 빌드가 실패해요.
- **환급:** 일반은 경비의 50%와 지역별 한도(1인, 2인 이상). 청년은 70%·1인 14만원(최대 2인, 시트에 '1인'으로 적힌 지역은 1인), 가족은 50%·1인 10만원(최대 5인). 우대 칸에 숫자가 없으면 '조건 확인 필요', '없음'이면 일반으로 계산해요.
- **최소 소비:** '최소 소비 금액' 설명 칸(1인·2인 이상, 1인당)을 숫자 칸보다 먼저 써요. 읽을 수 없으면 '확인 필요'로 표시해요.
- **좌표:** 캐시에 있으면 그 좌표, 없으면 지역 경계 안의 근사 위치(`approx: true`)에 놓고 화면에 안내해요.

## 시트에서 확인할 것 (빌드 경고, 2026-11-12 기준)

- 강진군: 최소 소비 설명 '(1인) 3만원 (2인 이상) 5만원'과 숫자 칸 10,000이 달라요. 설명 칸 기준으로 계산 중이에요.
- 고흥군: 최소 소비 칸에 한도 설명('20만원 소비 시 최대 10만원')이 들어 있어 계산에 못 써요.
- 식당 125곳 모두 가맹점 여부가 '미확인'이에요. 환급은 가맹점 결제만 인정돼요.
- 일부 메뉴 가격은 2인 기준이에요(예: 모듬회 2인). 화면은 1인 단가로 계산해요.
