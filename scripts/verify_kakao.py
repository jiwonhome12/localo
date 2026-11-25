"""카카오 장소 검색에서 상호와 지역이 일치하는 장소만 확인한다."""
import concurrent.futures
import json
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
for line in (ROOT / '.env').read_text(encoding='utf-8-sig').splitlines():
    if line.startswith('KAKAO_REST_API_KEY='):
        os.environ.setdefault('KAKAO_REST_API_KEY', line.split('=', 1)[1].strip().strip('"\''))
key = os.environ['KAKAO_REST_API_KEY']
places = json.loads((ROOT / 'data/places.json').read_text(encoding='utf-8'))
regions = {r['id']: r for r in json.loads((ROOT / 'data/regions.json').read_text(encoding='utf-8'))}

def norm(s):
    return re.sub(r'[^가-힣a-z0-9]', '', s.lower())

def verify(p):
    region = regions[p['region_id']]['name']
    params = urllib.parse.urlencode({'query': f"{region} {p['name']}", 'size': 15})
    request = urllib.request.Request('https://dapi.kakao.com/v2/local/search/keyword.json?' + params,
                                     headers={'Authorization': 'KakaoAK ' + key})
    with urllib.request.urlopen(request, timeout=20) as response:
        matches = json.load(response)['documents']
    for item in matches:
        address = item['road_address_name'] or item['address_name']
        if norm(item['place_name']) == norm(p['name']) and region in address:
            return p['id'], {'name': item['place_name'], 'address': address,
                             'lat': float(item['y']), 'lng': float(item['x']),
                             'place_url': item['place_url'].replace('http://', 'https://', 1)}
    return p['id'], None

with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    results = dict(pool.map(verify, places))
verified = {key: value for key, value in results.items() if value}
(ROOT / 'data/kakao-verified.json').write_text(json.dumps(verified, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
print(f'검색 확인 {len(verified)}곳 / {len(places)}곳')
