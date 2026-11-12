"""Export the two collected tabs without changing the source workbook."""
import datetime
import hashlib
import json
from pathlib import Path
import sys

import openpyxl


def value(cell):
    if isinstance(cell, (datetime.datetime, datetime.date)):
        return cell.strftime('%Y-%m-%d')
    return cell


def records(sheet):
    rows = sheet.iter_rows(values_only=True)
    headers = next(rows)
    for number, row in enumerate(rows, 2):
        yield number, {key: value(item) for key, item in zip(headers, row) if key}


def main():
    source = Path(sys.argv[1])
    workbook = openpyxl.load_workbook(source, data_only=True)
    regions = []
    for row, fields in records(workbook['신청·환급']):
        if not fields.get('시도') or not fields.get('지자체'):
            continue
        regions.append({'id': fields['지자체'], 'sourceRow': row, 'fields': fields})
    region_ids = {region['id'] for region in regions}
    places = []
    for row, fields in records(workbook['식당']):
        if not fields.get('식당명') or fields.get('지자체') == '(예시)':
            continue
        region_id = fields['지자체']
        if region_id not in region_ids:
            raise ValueError(f'Unknown region at restaurant row {row}')
        key = '|'.join(str(fields.get(name) or '') for name in ['지자체', '식당명', '주소'])
        places.append({'id': hashlib.sha256(key.encode()).hexdigest()[:16],
                       'regionId': region_id, 'sourceRow': row, 'fields': fields,
                       'coordinates': None, 'priceUnit': None, 'priceCheckedAt': None})
    if len({place['id'] for place in places}) != len(places):
        raise ValueError('Duplicate place records')
    payload = {'schemaVersion': 1, 'sourceFile': source.name,
               'sourceSheets': ['신청·환급', '식당'], 'regions': regions, 'places': places}
    destination = Path(__file__).resolve().parent / 'localo.json'
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Exported {len(regions)} regions and {len(places)} places')


if __name__ == '__main__':
    main()

