"""브이월드(국토교통부 공간정보 오픈플랫폼) 주소 검색으로 식당 좌표를 찾아 data/geocode-cache.json에 저장합니다.

    VWORLD_API_KEY=... python scripts/geocode.py            # 아직 없는 곳만 검색
    VWORLD_API_KEY=... python scripts/geocode.py --retry     # 못 찾은 곳도 다시 검색

상호명이 아니라 시트의 '주소'로 찾습니다(도로명 → 지번 → 읍·면·동 순).
공공 데이터라 결과를 저장해 공개 저장소에 둘 수 있습니다. 출처: 브이월드(국토교통부).
'○○읍'처럼 읍·면까지만 적힌 주소는 그 읍·면의 대표 위치가 되므로 approx(근사)로 표시합니다.
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
URL = 'https://api.vworld.kr/req/'


def call(path, **params):
    query = urllib.parse.urlencode({'service': params.pop('service'), 'version': '2.0', 'format': 'json',
                                    'crs': 'epsg:4326', **params})
    with urllib.request.urlopen(f'{URL}{path}?{query}', timeout=15) as response:
        return json.load(response).get('response', {})


def getcoord(key, address, kind):
    """정확한 도로명(ROAD)·지번(PARCEL) 주소 → 좌표"""
    res = call('address', service='address', request='getcoord', type=kind, address=address,
               refine='true', simple='false', key=key)
    if res.get('status') != 'OK':
        return None
    point = res['result']['point']
    return float(point['y']), float(point['x'])


def district(key, address, region):
    """'거창군 거창읍'처럼 읍·면·동까지만 있는 주소 → 행정구역 대표 위치"""
    res = call('search', service='search', request='search', type='district', category='L4',
               query=address, size='5', key=key)
    if res.get('status') != 'OK':
        return None
    for item in res['result'].get('items', []):
        if region in item.get('title', ''):
            return float(item['point']['y']), float(item['point']['x'])
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--retry', action='store_true', help='이전에 못 찾은 곳도 다시 검색')
    args = parser.parse_args()
    key = os.environ['VWORLD_API_KEY']
    source = json.loads((ROOT / 'localo.json').read_text(encoding='utf-8'))
    cache = json.loads(CACHE.read_text(encoding='utf-8')) if CACHE.exists() else {}
    found = missed = 0
    for place in source['places']:
        old = cache.get(place['id'])
        if old and not (args.retry and old.get('miss')):
            continue
        region, address = place['fields']['지자체'], str(place['fields'].get('주소') or '').strip()
        hit, how = None, None
        if address:
            for kind in ('ROAD', 'PARCEL'):
                hit = getcoord(key, address, kind)
                if hit:
                    how = kind.lower()
                    break
            if not hit:
                hit, how = district(key, address, region), 'district'
        if hit:
            cache[place['id']] = {'lat': round(hit[0], 6), 'lng': round(hit[1], 6), 'query': address,
                                  'by': how, 'source': 'vworld'}
            found += 1
        else:
            cache[place['id']] = {'miss': True, 'query': address, 'source': 'vworld'}
            missed += 1
        time.sleep(0.1)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    print(f'새로 찾음 {found}곳, 못 찾음 {missed}곳')


if __name__ == '__main__':
    main()
