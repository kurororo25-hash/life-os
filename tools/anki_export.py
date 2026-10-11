"""
anki_export.py - Ankiの実践数（復習した回数）を集計して data/anki-stats.json に書き出し、
GitHub に push する。生活OSの「Anki進捗」ページ（pages/anki.html）がこのJSONを読んで表示する。

使い方:
    python tools/anki_export.py            集計 → 変化があれば commit & push
    python tools/anki_export.py --no-push  集計してファイルに書くだけ

Windowsタスクスケジューラから1時間おきに起動している（登録内容は docs/操作メモ.md）。
Ankiが起動していない・AnkiConnectが応答しない等の場合は、ログに理由を書いて静かに終了する。
"""
import json
import subprocess
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent           # life-os/
OUT = ROOT / 'data' / 'anki-stats.json'
LOG = Path(__file__).resolve().parent / 'anki_export.log'
ANKI_URL = 'http://127.0.0.1:8765'
DETAIL_DAYS = 400   # 日別の詳細（正答率・時間・デッキ別）を持つ日数


def _log(msg):
    line = f'{datetime.now():%Y-%m-%d %H:%M:%S} {msg}'
    print(line)
    try:
        # ログは直近500行だけ残す
        old = LOG.read_text(encoding='utf-8').splitlines()[-499:] if LOG.exists() else []
        LOG.write_text('\n'.join(old + [line]) + '\n', encoding='utf-8')
    except OSError:
        pass


def ac(action, **params):
    req = urllib.request.Request(
        ANKI_URL, json.dumps({'action': action, 'version': 6, 'params': params}).encode())
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read())
    if d.get('error'):
        raise RuntimeError(f'{action}: {d["error"]}')
    return d['result']


def day_of(ms, rollover):
    """Ankiの「1日」は日付変更時刻(rollover)基準。例: rollover=4 なら深夜3時の復習は前日扱い。"""
    return (datetime.fromtimestamp(ms / 1000) - timedelta(hours=rollover)).strftime('%Y-%m-%d')


def detect_rollover(reviews, history):
    """AnkiConnectの日別件数と一致する日付変更時刻を探す（設定値をAPIで取れないため）。"""
    since = (datetime.now() - timedelta(days=60)).strftime('%Y-%m-%d')
    want = {d: c for d, c in history if d >= since}
    best, best_err = 4, None
    for h in range(0, 24):
        got = defaultdict(int)
        for r in reviews:
            got[day_of(r[0], h)] += 1
        # 削除済みカードの分だけ revlog 側が少なくなり得るので、差の合計で比較する
        err = sum(abs(want.get(d, 0) - got.get(d, 0)) for d in set(want) | {d for d in got if d >= since})
        if best_err is None or err < best_err:
            best, best_err = h, err
    return best


def collect():
    history = sorted(ac('getNumCardsReviewedByDay'))       # [[YYYY-MM-DD, 件数], ...] 全期間
    decks = ac('deckNames')

    reviews = []          # (id_ms, cardId, ease, durationMs, type, deckName)
    for name in decks:
        # cardReviews はサブデッキを含まない（そのデッキ直下のカードのみ）ので全デッキを回す
        for r in ac('cardReviews', deck=name, startID=0):
            reviews.append((r[0], r[1], r[3], r[7], r[8], name))
    reviews.sort()

    recent_ms = (time.time() - 70 * 86400) * 1000
    rollover = detect_rollover([r for r in reviews if r[0] >= recent_ms], history)

    first_seen = {}
    for r in reviews:
        first_seen.setdefault(r[1], r[0])

    since = (datetime.now() - timedelta(days=DETAIL_DAYS)).strftime('%Y-%m-%d')
    daily = defaultdict(lambda: {'again': 0, 'hard': 0, 'good': 0, 'easy': 0, 'new': 0, 'sec': 0})
    by_deck = defaultdict(lambda: defaultdict(int))
    for ms, cid, ease, dur, rtype, g in reviews:
        d = day_of(ms, rollover)
        if d < since:
            continue
        x = daily[d]
        if 1 <= ease <= 4:      # ease 0 は手動の日程変更などで、実際に答えた記録ではない
            x[('again', 'hard', 'good', 'easy')[ease - 1]] += 1
        if first_seen[cid] == ms:
            x['new'] += 1
        x['sec'] += round(dur / 1000)
        by_deck[g][d] += 1

    status = {
        'due': len(ac('findCards', query='is:due -is:suspended')),
        'newCards': len(ac('findCards', query='is:new -is:suspended')),
        'totalCards': len(ac('findCards', query='deck:*')),
    }

    return {
        'version': 1,
        'rolloverHour': rollover,
        'history': history,
        'daily': dict(sorted(daily.items())),
        'decks': {g: dict(sorted(v.items())) for g, v in sorted(by_deck.items())},
        'status': status,
    }


def git(*args):
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True,
                          encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))


def main():
    push = '--no-push' not in sys.argv
    try:
        ac('version')
    except Exception as e:
        _log(f'スキップ: Ankiに接続できません（Anki未起動？） {e}')
        return

    try:
        data = collect()
    except Exception as e:
        _log(f'スキップ: 集計中にエラー {e!r}')
        return

    old = None
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text(encoding='utf-8'))
            old.pop('generatedAt', None)
        except ValueError:
            pass
    if old == data:
        _log('変化なし')
        if push and 'ahead' in git('status', '-sb').stdout.splitlines()[0]:
            push_now()      # 前回pushに失敗した分を再送
        return

    data['generatedAt'] = datetime.now().astimezone().isoformat(timespec='seconds')
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    today = data['history'][-1] if data['history'] else ['-', 0]
    _log(f'書き出し完了 最新日 {today[0]}: {today[1]}回 / 期日カード {data["status"]["due"]}枚')

    if not push:
        return
    rel = 'data/anki-stats.json'
    git('add', rel)
    r = git('commit', '-m', f'Anki進捗データ更新 {data["generatedAt"][:16]}', '--', rel)
    if r.returncode != 0:
        _log(f'commitスキップ: {(r.stdout + r.stderr).strip()[:200]}')
        return
    push_now()


def push_now():
    r = git('push')
    if r.returncode != 0:
        _log(f'push失敗（次回また試します）: {r.stderr.strip()[:200]}')
        return
    _log('push完了')


if __name__ == '__main__':
    main()
