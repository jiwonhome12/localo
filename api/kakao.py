"""실시간 카카오 장소 검색. 응답은 저장하지 않습니다."""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get('query', [''])[0].strip()
        key = os.environ.get('KAKAO_REST_API_KEY', '').strip()
        if not key:
            return self.reply(503, {'error': '카카오 검색 설정이 필요합니다.'})
        if not 2 <= len(query) <= 100:
            return self.reply(400, {'error': '검색어를 확인해 주세요.'})
        url = 'https://dapi.kakao.com/v2/local/search/keyword.json?' + urllib.parse.urlencode({'query': query, 'size': 5})
        req = urllib.request.Request(url, headers={'Authorization': 'KakaoAK ' + key})
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.load(response)
            return self.reply(200, {'documents': [{k: p.get(k, '') for k in ('place_name', 'road_address_name', 'address_name', 'place_url')} for p in data.get('documents', [])]})
        except (urllib.error.URLError, TimeoutError, ValueError):
            return self.reply(502, {'error': '카카오 장소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.'})

    def reply(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
