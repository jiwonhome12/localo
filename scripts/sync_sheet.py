"""팀 수집 시트의 '신청·환급'과 '식당' 탭을 localo.json으로 내보냅니다.

    python scripts/sync_sheet.py --api                  # Google Sheets API (GitHub Actions)
    python scripts/sync_sheet.py --xlsx "수집 시트.xlsx"   # 내려받은 엑셀 파일

--api 는 환경 변수 GOOGLE_SERVICE_ACCOUNT_JSON(서비스 계정 JSON 키 전체)이 필요하고,
시트가 그 서비스 계정 이메일에 '뷰어'로 공유돼 있어야 합니다.
원본 시트는 읽기만 하고 바꾸지 않습니다.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'localo.json'
SPREADSHEET_ID = os.environ.get('LOCALO_SHEET_ID', '1lu6igdjUa88UsXR99MP6O59_00lbXfzIsQvd-9zxzoA')
REGION_TAB, PLACE_TAB = '신청·환급', '식당'
SOURCE_NAME = '반값여행 25개 지자체 팀 수집 시트'


def cell(value):
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.strftime('%Y-%m-%d')
    if value == '':
        return None
    return value


def rows_from_api():
    from google.auth.transport.requests import AuthorizedSession
    from google.oauth2 import service_account

    info = json.loads(os.environ['GOOGLE_SERVICE_ACCOUNT_JSON'])
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=['https://www.googleapis.com/auth/spreadsheets.readonly'])
    params = [('ranges', f"'{tab}'") for tab in (REGION_TAB, PLACE_TAB)]
    # 금액은 "100,000" 같은 표시 문자열이 아니라 숫자로, 날짜는 시트에 보이는 문자열로 받는다
    params += [('valueRenderOption', 'UNFORMATTED_VALUE'), ('dateTimeRenderOption', 'FORMATTED_STRING')]
    url = f'https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values:batchGet'
    response = AuthorizedSession(creds).get(url, params=params, timeout=30)
    response.raise_for_status()
    ranges = response.json()['valueRanges']
    return {tab: [[cell(v) for v in row] for row in r.get('values', [])]
            for tab, r in zip((REGION_TAB, PLACE_TAB), ranges)}


def rows_from_xlsx(path):
    import openpyxl

    workbook = openpyxl.load_workbook(path, data_only=True)
    return {tab: [[cell(v) for v in row] for row in workbook[tab].iter_rows(values_only=True)]
            for tab in (REGION_TAB, PLACE_TAB)}


def records(rows):
    headers = rows[0]
    for number, row in enumerate(rows[1:], 2):
        yield number, {h: (row[i] if i < len(row) else None) for i, h in enumerate(headers) if h}


def build_payload(tabs, source):
    regions = []
    for row, fields in records(tabs[REGION_TAB]):
        if not fields.get('시도') or not fields.get('지자체'):
            continue  # 빈 줄과 표 아래 안내 문구
        regions.append({'id': fields['지자체'], 'sourceRow': row, 'fields': fields})
    region_ids = {region['id'] for region in regions}
    places = []
    for row, fields in records(tabs[PLACE_TAB]):
        if not fields.get('식당명') or fields.get('지자체') == '(예시)':
            continue
        if fields.get('지자체') not in region_ids:
            raise ValueError(f"식당 탭 {row}행: 신청·환급 탭에 없는 지자체 '{fields.get('지자체')}'")
        key = '|'.join(str(fields.get(name) or '') for name in ['지자체', '식당명', '주소'])
        places.append({'id': hashlib.sha256(key.encode()).hexdigest()[:16],
                       'regionId': fields['지자체'], 'sourceRow': row, 'fields': fields,
                       'coordinates': None, 'priceUnit': None, 'priceCheckedAt': None})
    if len({place['id'] for place in places}) != len(places):
        raise ValueError('식당 탭에 지자체·식당명·주소가 같은 줄이 두 번 있습니다')
    return {'schemaVersion': 1, 'sourceFile': source, 'sourceSheets': [REGION_TAB, PLACE_TAB],
            'regions': regions, 'places': places}


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--api', action='store_true', help='Google Sheets API로 읽기')
    source.add_argument('--xlsx', type=Path, help='내려받은 엑셀 파일 경로')
    args = parser.parse_args()
    if args.api:
        payload = build_payload(rows_from_api(), SOURCE_NAME)
    else:
        payload = build_payload(rows_from_xlsx(args.xlsx), args.xlsx.name)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"localo.json: 지역 {len(payload['regions'])}곳, 식당 {len(payload['places'])}곳")


if __name__ == '__main__':
    main()
