# CLAUDE.md - 生活OS プロジェクト

このファイルは Claude Code が後から読んで状況を理解するためのファイルです。

---

## プロジェクト概要

**名前**: 生活OS  
**目的**: リマインダー・在庫管理・買い物・メモ・日記など、日常生活の管理をまとめるWebアプリ  
**公開先**: GitHub Pages（予定）  
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
├── index.html          ホーム画面（機能カード一覧）
├── manifest.json       PWA設定（iPhoneホーム画面追加用）
├── css/
│   └── style.css       全ページ共通スタイル
├── js/
│   ├── storage.js      localStorage読み書き共通関数
│   ├── common.js       全ページ共通ユーティリティ（toast・日付・削除確認など）
│   └── memo-base.js    メモ系ページ共通ロジック（4ページで共有）
├── pages/
│   ├── timebox.html    タイムボクシング
│   ├── reminder.html   リマインダー
│   ├── inventory.html  在庫管理
│   ├── shopping.html   買い物リスト
│   ├── appliance.html  家電メモ
│   ├── cleaning.html   掃除手順
│   ├── laundry.html    洗濯手順
│   ├── cargo.html      車内荷物管理
│   ├── memo-work.html  仕事メモ
│   ├── memo-study.html 学習メモ
│   ├── memo-health.html 健康メモ
│   ├── memo-training.html トレーニングメモ
│   └── diary.html      日記・生活ログ
└── docs/               説明ドキュメント群
```

---

## データ設計（localStorageキー一覧）

| キー名 | 使用ページ | 主な項目 |
|--------|-----------|---------|
| `life_timebox`       | timebox.html    | date, title, startTime, endTime（30分固定）, done, gcalEventId |
| `life_reminders`     | reminder.html   | title, date, repeat, priority, done, notes |
| `life_inventory`     | inventory.html  | name, category, unit, currentCount, minCount, location, notes |
| `life_shopping`      | shopping.html   | name, quantity, category, source, inventoryId, bought, notes |
| `life_appliances`    | appliance.html  | name, maker, model, location, purchase, warranty, price, notes |
| `life_cleaning`      | cleaning.html   | title, freq, time, steps[], tools, notes |
| `life_laundry`       | laundry.html    | title, course, temp, steps[], detergent, target, notes |
| `life_cargo`         | cargo.html      | name, category, qty, location, always, notes |
| `life_memo_work`     | memo-work.html  | title, content, tags[], pinned |
| `life_memo_study`    | memo-study.html | title, content, tags[], pinned |
| `life_memo_health`   | memo-health.html| title, content, tags[], pinned |
| `life_memo_training` | memo-training.html | title, content, tags[], pinned |
| `life_diary`         | diary.html      | date, mood, content |

---

## 機能間の連携

- **在庫管理 → 買い物リスト**: `currentCount <= minCount` のとき「買い物リストへ」ボタンが表示される。
  押すと `life_shopping` に `source: 'inventory', inventoryId: ID` でレコードが追加される。
- **買い物リスト → 在庫管理**: 在庫から来た項目を「購入済み」にすると、対応する在庫の `currentCount` が +1 される。
- **ホーム画面バッジ**: 起動時に各ストレージを読んで件数バッジを表示する。

---

## 開発方針

- シンプルに保つ。外部依存ゼロ。
- メモ系4ページ（work/study/health/training）は `memo-base.js` に共通ロジックを持ち、`initMemo({key, icon, label})` で初期化する。
- 各ページは `<script src="../js/storage.js">` `<script src="../js/common.js">` を読み込んでから動作する。
- 追加機能はページを増やすか、既存ページに機能を追加する形で育てる。

---

## 注意事項

- localStorage はブラウザごと・端末ごとに独立している（iPhoneとPCはデータが別）
- HTTPS 環境でのみ PWA として動作する（GitHub Pages は HTTPS なので問題なし）
- APIキーやパスワードはファイルに書かない
- icon.png は現時点では未作成。GitHub Pages に上げる前に作成が必要（なくても動くが、ホーム画面追加時のアイコンが空になる）

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-07-12 | タイムボクシング（timebox.html）を追加。日単位の視覚的タイムライン＋予定リスト |
| 2026-06-29 | 初期作成。全12機能ページ＋共通CSS/JS を構築 |
