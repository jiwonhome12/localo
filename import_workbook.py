"""예전 명령을 그대로 쓰기 위한 바로가기입니다: python import_workbook.py "수집 시트.xlsx"
실제 내보내기는 scripts/sync_sheet.py 가 맡습니다(--api 로 시트에서 바로 읽기도 가능)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'scripts'))
import sync_sheet  # noqa: E402

if __name__ == '__main__':
    sys.argv = [sys.argv[0], '--xlsx', *sys.argv[1:]]
    sync_sheet.main()
