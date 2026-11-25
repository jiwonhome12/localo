"""로컬 정적 파일과 카카오 검색 API 서버. python scripts/serve.py"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from api.kakao import handler as KakaoHandler

env = ROOT / '.env'
if env.exists():
    for line in env.read_text(encoding='utf-8-sig').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"\''))
os.chdir(ROOT)


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/kakao':
            return KakaoHandler.do_GET(self)
        if any(part.startswith('.') for part in unquote(path).split('/') if part):
            return self.send_error(404)
        return super().do_GET()

    reply = KakaoHandler.reply


if __name__ == '__main__':
    port = int(os.environ.get('LOCALO_PORT', '8765'))
    print(f'http://localhost:{port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
