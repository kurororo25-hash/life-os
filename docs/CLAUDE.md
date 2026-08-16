# CLAUDE.md - 生活OS プロジェクト

このファイルは Claude Code が後から読んで状況を理解するためのファイルです。

---

## プロジェクト概要

**名前**: 生活OS  
**目的**: リマインダー・タイムボクシング・ライフログ・整備管理・習慣チェック・月次チェックなど、日常生活の管理をまとめるWebアプリ  
**公開先**: GitHub Pages（公開済み） — `https://kurororo25-hash.github.io/life-os/index.html`  
**対象端末**: iPhone（ホーム画面に追加してPWA的に使用）＋ Windows 11  

---

## 技術スタック

- HTML / CSS / JavaScript のみ（サーバー不要）
- localStorage にデータ保存
- 外部ライブラリ・フレームワークは使わない
- GitHub Pages で静的ファイルとして公開

---

## フォルダ構成

```
life-os/
├── index.html          ホーム画面（機能カード一覧・端末間同期パネル）
├── manifest.json       PWA設定（iPhoneホーム画面追加用）
├── sw.js               Service Worker（通知の表示＋アプリ本体のオフラインキャッシュ）
├── icon.png / icon-512.png / apple-touch-icon.png  ホーム画面・通知用アイコン
├── css/
│   └── style.css       全ページ共通スタイル（ダークモード対応込み）
├── js/
│   ├── storage.js          localStorage読み書き共通関数
│   ├── common.js           全ページ共通ユーティリティ（toast・日付・削除確認など）
│   ├── sync.js             PC・iPhone間のGoogleドライブ経由データ同期
│   ├── google-calendar.js  リマインダー・タイムボクシングのGoogleカレンダー連携
│   └── notifications.js    Service Worker登録・リマインダー期限の通知チェック
├── pages/
│   ├── reminder.html    リマインダー（todoリスト形式）
│   ├── timebox.html     タイムボクシング
│   ├── lifelog.html     ライフログ（一日の振り返り）
│   ├── maintenance.html 整備管理（車）
│   ├── habit.html       習慣チェック（毎日リセット）
│   └── monthly.html     月次チェック（毎月リセット）
└── docs/                説明ドキュメント群
```

---

## データ設計（localStorageキー一覧）

| キー名 | 使用ページ | 主な項目 |
|--------|-----------|---------|
| `life_reminders`        | reminder.html    | title, date, time, repeat, priority, done, notes, gcalEventId |
| `life_timebox`          | timebox.html     | date, title, startTime, endTime（30分固定）, done, gcalEventId |
| `life_lifelog`          | lifelog.html     | date, title, startTime, endTime（自由な長さ）, mood, notes |
| `life_maintenance`      | maintenance.html | name, lastDate, nextDate, nextKm, notes |
| `life_maintenance_meta` | maintenance.html | mileage（現在の走行距離） |
| `life_habit_habits`     | habit.html       | id, name, period（朝/夜など） |
| `life_habit`            | habit.html       | date, checks（habit id → true/false） |
| `life_monthly_tasks`    | monthly.html     | id, label |
| `life_monthly`          | monthly.html     | month（YYYY-MM）, checks（task id → true/false） |
| `life_sync_tombstones`  | 全ページ共通     | 同期時に削除をマージへ反映するための削除記録（Storage.remove/restoreが管理） |

---

## 機能間の連携

- **ホーム画面バッジ**: 起動時に各ストレージを読んで件数バッジを表示する。

---

## 開発方針

- シンプルに保つ。外部依存ゼロ。
- 各ページは `<script src="../js/storage.js">` `<script src="../js/common.js">` を読み込んでから動作する。
- 追加機能はページを増やすか、既存ページに機能を追加する形で育てる。

---

## 注意事項

- localStorage はブラウザごと・端末ごとに独立している（iPhoneとPCはデータが別）
- HTTPS 環境でのみ PWA として動作する（GitHub Pages は HTTPS なので問題なし）
- APIキーやパスワードはファイルに書かない
- Service Worker（sw.js）はアプリ本体一式をキャッシュしてオフライン対応している。ファイル構成を変えたら `sw.js` 内の `CACHE_VERSION` を上げること（上げないと古いキャッシュが残り続ける）

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-08-16 | 月次チェック（monthly.html）を追加。habit.htmlと同じUI・ロジック（追加・編集・削除・並び替え・進捗バー）だが、リセット単位が「日」ではなく「月」（保存している`month`がYYYY-MM形式で、開いた月と違えばチェックを空にリセット）。振込・請求書確認・口座残高チェックなど毎月やることの管理用。初期タスクは「家賃・ローンの振込」「クレジットカード請求書の確認」「口座残高チェック」「公共料金の支払い確認」を仮登録（自由に編集・削除可）。ホーム画面にカード＋未完了件数バッジを追加、sw.jsのプリキャッシュ対象にも追加してCACHE_VERSIONをv2に更新 |
| 2026-08-01 | 欠けていた icon.png（192/512px）・apple-touch-icon.png を作成し manifest.json / index.html に反映。CSS変数のダーク値を `prefers-color-scheme: dark` で上書きするダークモード対応を追加（habit.htmlの背景白固定バグ・GCal注意書きの文字色固定も合わせて修正）。sw.js にアプリ本体一式のプリキャッシュを追加し、オフラインでも開けるように変更。docs（本ファイル・今後やること.md）を実装済み項目に合わせて更新 |
| 2026-07-26 | リマインダー・タイムボクシングのスペース区切り一括追加を編集モーダルでも使えるように拡張（1件目が編集対象を更新、2件目以降は新規追加） |
| 2026-07-26 | リマインダー（reminder.html）に、タイムボクシングと同じスペース区切り一括追加を実装（新規追加時のみタイトルを空白で分割し、それぞれ独立したリマインダーとして保存） |
| 2026-07-26 | リマインダー（reminder.html）をtodoリストとして改善。日付グループ表示（期限切れ/今日/明日/今週/それ以降/未定）、タブ件数、日付順/優先度順の並び替え、クイック日付ボタン、スワイプ削除＋元に戻すトーストを追加。common.js/storage.js に共通の showToast アクションボタン・Storage.restore を追加 |
| 2026-07-20 | ライフログ（lifelog.html）を追加。タイムボクシングと同じ縦タイムラインUIで、一日の振り返り用に開始〜終了時刻・気分・メモを記録できる。保存後に続けて次の枠を入力できる仕組みも実装 |
| 2026-07-20 | 在庫管理・買い物リスト・車内荷物・仕事メモ・学習メモ・健康メモ・トレーニングメモ・日記ログを削除（memo-base.js も削除） |
| 2026-07-12 | タイムボクシング（timebox.html）を追加。日単位の視覚的タイムライン＋予定リスト |
| 2026-06-29 | 初期作成。全12機能ページ＋共通CSS/JS を構築 |
