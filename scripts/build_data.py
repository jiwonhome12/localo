"""localo.json(수집 시트 내보내기)을 화면이 읽는 data/regions.json, data/places.json으로 바꿉니다.

    python scripts/build_data.py

검증에 실패하면 아무 파일도 쓰지 않고 종료 코드 1로 끝납니다. 그래서 GitHub Actions에서
팀원이 시트에 잘못 입력해도 사이트는 마지막 정상 데이터를 그대로 보여줍니다.
경고(⚠)는 파일을 쓰되 시트에서 다시 확인할 칸을 알려줍니다.
"""
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
STATUS = {'신청접수중': 'open', '준비중': 'soon', '마감': 'closed'}
CATEGORY = {'음식점': 'food', '카페·베이커리': 'cafe'}
MERCHANT = {'예', '아니오', '미확인'}

errors, warnings = [], []


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def text(value):
    return '' if value is None else str(value).strip()


def field(fields, prefix):
    """'신청 상태(11/5 기준)'처럼 날짜가 바뀌는 열 이름을 앞부분으로 찾는다."""
    for key, value in fields.items():
        if key.startswith(prefix):
            return value
    return None


def man(s):
    return [round(float(a) * 10000) for a in re.findall(r'(\d+(?:\.\d+)?)\s*만', s)]


def money(value):
    """100000 · '100,000' · '최대 10만원' · '20만원 소비 시 최대 10만원' → 원 단위 정수."""
    if value is None or value == '':
        return None
    if isinstance(value, (int, float)):
        return round(value)
    s = str(value).replace(',', '').strip()
    if re.fullmatch(r'\d+(\.\d+)?', s):
        return round(float(s))
    capped = re.search(r'최대\s*(\d+(?:\.\d+)?)\s*만', s)
    if capped:
        return round(float(capped.group(1)) * 10000)
    amounts = man(s)
    return amounts[0] if len(amounts) == 1 else None


def min_spend(region, description, number):
    """최소 소비 금액. 설명 칸이 숫자 칸보다 자세해서(1인/2인 이상, 1인당) 설명 칸을 먼저 쓴다."""
    s, amounts = text(description), man(text(description))
    parsed = None
    if s and '최대' not in s:  # '20만원 소비 시 최대 10만원'은 최소 금액이 아니라 한도 설명
        if '1인당' in s and len(amounts) == 1:
            parsed = {'one': amounts[0], 'group': amounts[0], 'per_person': True}
        elif '1인' in s and '2인' in s and len(amounts) == 2:
            parsed = {'one': amounts[0], 'group': amounts[1], 'per_person': False}
        elif '1인' not in s and '2인' not in s and len(amounts) == 1:
            parsed = {'one': amounts[0], 'group': amounts[0], 'per_person': False}
    value = money(number)
    if parsed:
        if value is not None and value != parsed['one']:
            warnings.append(f"{region}: 최소 소비 금액 설명('{s.replace(chr(10), ' ')}')과 숫자 칸({value:,})이 달라 설명 칸 기준으로 계산")
        return parsed
    if s:
        warnings.append(f"{region}: 최소 소비 금액('{s.replace(chr(10), ' ')}')을 계산에 쓸 수 없어 '확인 필요'로 표시")
        return None
    return {'one': value, 'group': value, 'per_person': False} if value is not None else None


def perks(t):
    """청년·가족 우대 설명 → 'yes'(조건 확인됨) · 'no'(없음) · 'unknown'(확인 필요)."""
    t = text(t)
    if '없음' in t:
        return {'youth': 'no', 'family': 'no', 'youth_max': 0}
    youth = 'yes' if '청년' in t and ('70%' in t or '14만' in t) else 'unknown'
    family = 'yes' if '가족' in t and '50만' in t else 'unknown'
    youth_max = 2
    if '28만' not in t and '최대 2인' not in t and re.search(r'청년[^/]*1인\)', t):
        youth_max = 1
    return {'youth': youth, 'family': family, 'youth_max': youth_max}


# ───────── 지도 좌표 ─────────
def rings(d):
    out = []
    for part in d.split('M')[1:]:
        nums = [float(n) for n in part.replace('Z', ' ').split()]
        out.append(list(zip(nums[0::2], nums[1::2])))
    return out


def inside(x, y, polys):
    hit = False
    for ring in polys:
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                hit = not hit
    return hit


def to_xy(proj, lat, lng):
    return (round(proj['pad'] + (lng - proj['lon0']) * proj['k'] * proj['cos'], 2),
            round(proj['pad'] + (proj['lat0'] - lat) * proj['k'], 2))


def to_latlng(proj, x, y):
    return (round(proj['lat0'] - (y - proj['pad']) / proj['k'], 5),
            round(proj['lon0'] + (x - proj['pad']) / (proj['k'] * proj['cos']), 5))


def spread(geo_region, count, taken):
    """좌표가 아직 없는 장소를 지역 안에 겹치지 않게 놓는다(위치는 근사값)."""
    polys = rings(geo_region['d'])
    x0, y0, x1, y1 = geo_region['bbox']
    step = math.sqrt((x1 - x0) * (y1 - y0)) * 0.13
    points, k = [], 0
    while len(points) < count and k < 4000:
        r, a = step * math.sqrt(k), k * 2.39996
        x, y = geo_region['cx'] + r * math.cos(a), geo_region['cy'] + r * math.sin(a)
        k += 1
        if inside(x, y, polys) and all(math.hypot(x - px, y - py) > step * 0.9 for px, py in points + taken):
            points.append((x, y))
    while len(points) < count:  # 아주 작은 지역: 중심에 겹쳐 놓는다
        points.append((geo_region['cx'], geo_region['cy']))
    return points


def main():
    src = load(ROOT / 'localo.json')
    geo = load(DATA / 'geo.json')
    extras = load(DATA / 'region-extras.json')
    cache_path = DATA / 'geocode-cache.json'
    cache = load(cache_path) if cache_path.exists() else {}
    samples = load(DATA / 'places.sample.json')
    proj = geo['projection']
    if src.get('schemaVersion') != 1:
        sys.exit('localo.json schemaVersion 1만 지원합니다')

    by_name = {(g['sido'], g['name']): key for key, g in geo['regions'].items()}
    regions, rid_of = [], {}
    for item in src['regions']:
        f = item['fields']
        name, sido = text(f.get('지자체')), text(f.get('시도'))
        rid = by_name.get((sido, name))
        if not rid:
            errors.append(f"신청·환급 {item['sourceRow']}행: 지도에 없는 지역 '{sido} {name}'")
            continue
        status_text = text(field(f, '신청 상태('))
        if status_text not in STATUS:
            errors.append(f"신청·환급 {item['sourceRow']}행 {name}: 신청 상태 '{status_text}'는 신청접수중·준비중·마감 중 하나여야 함")
            continue
        cap_1, cap_group = money(f.get('환급 한도 1인(원) ★')), money(f.get('환급 한도 2인 이상(원) ★'))
        for label, value, raw in (('1인', cap_1, f.get('환급 한도 1인(원) ★')), ('2인 이상', cap_group, f.get('환급 한도 2인 이상(원) ★'))):
            if value is None:
                warnings.append(f"{name}: 환급 한도 {label}('{text(raw)}')를 숫자로 읽지 못해 '확인 필요'로 표시")
        rid_of[name] = rid
        extra = extras.get(rid, {})
        regions.append({
            'id': rid, 'name': name, 'sido': sido, 'status': STATUS[status_text],
            'tour_resident_card': extra.get('tour_resident_card', False), 'half': extra.get('half', ''),
            'status_checked_at': text(f.get('신청 상태 확인일')),
            'source_row': item['sourceRow'],
            'period': text(f.get('사업 기간')), 'round': text(f.get('현재 차수 일정 ★')),
            'currency': text(f.get('지역화폐(환급·결제 수단)')), 'visit_rule': text(f.get('방문 인증 조건')),
            'payment_rule': text(f.get('결제·증빙 조건')), 'apply': text(f.get('사전신청 방법 ★')),
            'refund_process': text(f.get('환급 절차·소요 기간 ★')), 'voucher_expiry': text(f.get('상품권 사용기한 ★')),
            'site': text(f.get('공식 사이트')), 'eligibility': text(f.get('지원대상')),
            'min_spend_text': text(f.get('최소 소비 금액')), 'perks_text': text(f.get('청년·가족 우대 ★')),
            'rule': {'rate': 0.5, 'cap_1': cap_1, 'cap_group': cap_group,
                     'min_spend': min_spend(name, f.get('최소 소비 금액'), f.get('최소 소비 금액(원)')),
                     **perks(f.get('청년·가족 우대 ★'))},
        })

    places, need_spot = [], {}
    for item in src['places']:
        f = item['fields']
        rid = rid_of.get(item['regionId'])
        if not rid:
            errors.append(f"식당 {item['sourceRow']}행: 지역 '{item['regionId']}'을 찾지 못함")
            continue
        category = CATEGORY.get(text(f.get('업종')))
        if not category:
            errors.append(f"식당 {item['sourceRow']}행: 업종 '{text(f.get('업종'))}'은 음식점·카페·베이커리 중 하나여야 함")
            continue
        merchant = text(f.get('지역화폐 가맹점 여부')) or '미확인'
        if merchant not in MERCHANT:
            warnings.append(f"식당 {item['sourceRow']}행: 가맹점 여부 '{merchant}' → 미확인으로 처리")
            merchant = '미확인'
        price, menu = money(f.get('대표 메뉴 가격(원)')), text(f.get('대표 메뉴'))
        if price is None:
            warnings.append(f"식당 {item['sourceRow']}행 {text(f.get('식당명'))}: 대표 메뉴 가격이 비어 있음")
        address = text(f.get('주소'))
        prefix = f"{text(f.get('지자체'))} "
        short = address.split(prefix, 1)[1] if prefix in address else address
        place = {
            'id': item['id'], 'region_id': rid, 'category': category, 'name': text(f.get('식당명')),
            'price': price or 0,
            'price_text': f"{menu} {price:,}원" if price else (menu or '가격 확인 필요'),
            'access_text': short or '주소 확인 필요', 'capacity': 0,
            'menu': menu, 'address': address, 'rating': text(f.get('평점·후기 출처')),
            'source_url': text(f.get('출처 URL')), 'note': text(f.get('메모')), 'reason': text(f.get('선정 이유')),
            'merchant': merchant, 'source_row': item['sourceRow'], 'sample': False,
        }
        hit = cache.get(item['id'])
        if hit and not hit.get('miss'):
            place['lat'], place['lng'] = hit['lat'], hit['lng']
            place['x'], place['y'] = to_xy(proj, hit['lat'], hit['lng'])
            place['approx'] = False
            if hit.get('place_url'):
                place['map_url'] = hit['place_url']
        else:
            need_spot.setdefault(rid, []).append(place)
        places.append(place)

    kept = [p for p in samples if p['category'] in ('stay', 'spot')]  # 숙박·관광지는 아직 예시
    for rid, group in need_spot.items():
        taken = [(p['x'], p['y']) for p in places + kept if p['region_id'] == rid and 'x' in p]
        for place, (x, y) in zip(group, spread(geo['regions'][rid], len(group), taken)):
            place['x'], place['y'] = round(x, 2), round(y, 2)
            place['lat'], place['lng'] = to_latlng(proj, x, y)
            place['approx'] = True

    if len({p['id'] for p in places + kept}) != len(places) + len(kept):
        errors.append('장소 id가 겹칩니다')
    for w in warnings:
        print('⚠', w)
    if errors:
        for e in errors:
            print('✗', e)
        sys.exit(f'검증 실패 {len(errors)}건 — 파일을 쓰지 않았습니다')
    write = lambda path, value: path.write_text(json.dumps(value, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    write(DATA / 'regions.json', regions)
    write(DATA / 'places.json', places + kept)
    approx = sum(1 for p in places if p['approx'])
    print(f'regions.json {len(regions)}곳 · places.json 식당·카페 {len(places)}곳(위치 근사 {approx}곳) + 예시 숙박·관광지 {len(kept)}곳')


if __name__ == '__main__':
    main()
