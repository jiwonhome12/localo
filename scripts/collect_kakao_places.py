"""지역별 카카오 장소 검색 결과를 수집한다. KAKAO_REST_API_KEY 필요."""
import concurrent.futures
import json
import os
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
env = ROOT / '.env'
if env.exists():
    for line in env.read_text(encoding='utf-8-sig').splitlines():
        if line.startswith('KAKAO_REST_API_KEY='):
            os.environ.setdefault('KAKAO_REST_API_KEY', line.split('=', 1)[1].strip().strip('"\''))
KEY = os.environ['KAKAO_REST_API_KEY']
regions = json.loads((ROOT / 'data/regions.json').read_text(encoding='utf-8'))
queries = [('food', '맛집', 'FD6'), ('cafe', '카페', 'CE7'),
           ('stay', '숙박', 'AD5'), ('spot', '관광지', 'AT4')]
province = {'강원': ('강원', '강원특별자치도', '강원도'), '충북': ('충북', '충청북도'), '충남': ('충남', '충청남도'),
            '경북': ('경북', '경상북도'), '경남': ('경남', '경상남도'),
            '전북': ('전북', '전라북도', '전북특별자치도'), '전남': ('전남', '전라남도', '전남광주통합특별시')}

def fetch(task):
    region, category, keyword, group = task
    found = []
    for page in range(1, 4):
        params = urllib.parse.urlencode({'query': region['name'] + ' ' + keyword,
                                         'category_group_code': group, 'size': 15, 'page': page})
        req = urllib.request.Request('https://dapi.kakao.com/v2/local/search/keyword.json?' + params,
                                     headers={'Authorization': 'KakaoAK ' + KEY})
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.load(response)
        for item in result['documents']:
            address = item['address_name']
            if not any(address.startswith(p + ' ') for p in province[region['sido']]):
                continue
            if region['name'] not in address.split():
                continue
            if not (item['id'].isdigit() and item['x'] and item['y']):
                continue
            found.append({'id': 'kakao-' + item['id'], 'region_id': region['id'],
                          'category': category, 'name': item['place_name'],
                          'address': item['road_address_name'] or address,
                          'lat': float(item['y']), 'lng': float(item['x']),
                          'kakao_url': 'https://place.map.kakao.com/' + item['id'],
                          'category_name': item['category_name'], 'checked_at': str(date.today())})
        if result['meta']['is_end']:
            break
    return found

tasks = [(r, *q) for r in regions for q in queries]
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    results = list(pool.map(fetch, tasks))
unique = {item['id']: item for batch in results for item in batch}
path = ROOT / 'data/kakao-places.json'
path.write_text(json.dumps(list(unique.values()), ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
print(f'지역 {len(regions)}곳, 카카오 장소 {len(unique)}곳 수집')
