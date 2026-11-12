"""카카오 로컬 API로 식당 좌표를 찾아 data/geocode-cache.json에 저장합니다.

    KAKAO_REST_API_KEY=... python scripts/geocode.py            # 아직 없는 곳만 검색
    KAKAO_REST_API_KEY=... python scripts/geocode.py --retry     # 못 찾은 곳도 다시 검색

'지자체 식당명'으로 키워드 검색하고, 주소에 그 지자체 이름이 들어 있는 첫 결과만 씁니다.
못 찾은 곳은 miss로 남기고, 화면에서는 지역 안 근사 위치로 표시됩니다.
"""
import argparse
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'data' / 'geocode-cache.json'
URL = 'https://dapi.kakao.com/v2/local/search/keyword.json'


def search(key, query):
    request = urllib.request.Request(f'{URL}?{urllib.parse.urlencode({"query": query, "size": 5})}',
                                     headers={'Authorization': f'KakaoAK {key}'})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)['documents']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--retry', action='store_true', help='이전에 못 찾은 곳도 다시 검색')
    args = parser.parse_args()
    key = os.environ['KAKAO_REST_API_KEY']
    source = json.loads((ROOT / 'localo.json').read_text(encoding='utf-8'))
    cache = json.loads(CACHE.read_text(encoding='utf-8')) if CACHE.exists() else {}
    found = missed = 0
    for place in source['places']:
        old = cache.get(place['id'])
        if old and not (args.retry and old.get('miss')):
            continue
        region, name = place['fields']['지자체'], place['fields']['식당명']
        query = f'{region} {name}'
        docs = [d for d in search(key, query) if region in (d.get('road_address_name') or d.get('address_name') or '')]
        if docs:
            d = docs[0]
            cache[place['id']] = {'lat': round(float(d['y']), 6), 'lng': round(float(d['x']), 6),
                                  'query': query, 'place_name': d['place_name'],
                                  'address': d.get('road_address_name') or d['address_name'],
                                  'place_url': d.get('place_url')}
            found += 1
        else:
            cache[place['id']] = {'miss': True, 'query': query}
            missed += 1
        time.sleep(0.1)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    print(f'새로 찾음 {found}곳, 못 찾음 {missed}곳')


if __name__ == '__main__':
    main()
