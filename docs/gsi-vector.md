# 地理院地図Vector 調査メモ

2026-09-20 時点の実地確認。

## 使っているデータ

国土地理院の**最適化ベクトルタイル**（`optimal_bvmap-v1`）と、その標準地図風スタイル。

| 用途 | URL | CORS |
| --- | --- | --- |
| スタイル定義 | `https://gsi-cyberjapan.github.io/optimal_bvmap/style/std.json` | `*` |
| ベクトルタイル (XYZ) | `https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/{z}/{x}/{y}.pbf` | `*` |
| sprite | `https://gsi-cyberjapan.github.io/optimal_bvmap/sprite/std` | `*` |
| glyphs | `https://gsi-cyberjapan.github.io/optimal_bvmap/glyphs/{fontstack}/{range}.pbf` | `*` |

いずれも `Access-Control-Allow-Origin: *` を返すため、GitHub Pages から
サーバーサイドなしで直接参照できる。ズーム範囲は minzoom 4 / maxzoom 16。

### pmtiles ではなく XYZ を使う理由

公式スタイルの `sources.v.tiles` は `pmtiles://…` を指しており、そのままでは
`pmtiles` ライブラリのプロトコル登録が必要になる。同じデータが XYZ でも
配信されているので、依存を増やさないよう `experiments/01-.../map.ts` で
取得後の style オブジェクトの `tiles` を XYZ URL に差し替えている。

## レイヤー構成と、グループに畳む理由

スタイル定義のレイヤーは **123 個**、`source-layer` は 25 種類。
ただしレイヤー ID の多くは描画順を作るための機械的な分割になっている。

```
鉄道中心線0  鉄道中心線1  … 鉄道中心線4
鉄道中心線橋ククリ白0 … 鉄道中心線橋ククリ白4
鉄道中心線旗竿橋0 … 鉄道中心線旗竿橋4
```

「鉄道」に相当するレイヤーだけで 41 個ある。これをそのまま Jev に渡すと

- 質問数と入力トークンが無駄に増える
- 「鉄道を強調して」に対する判断が 41 個に分散し、一部だけ消えるような
  中途半端な結果になりうる

ため、`scripts/build-layer-catalog.mjs` で**人間が地図を語る粒度**
（鉄道 / 道路 / 建築物 / 注記 …）へ畳んでいる。

結果: **123 レイヤー → 24 グループ**（うち `background` は常時表示なので
判断対象は 23）。未分類は 0 件。分類漏れが出た場合はスクリプトが警告を出す。

### グループ一覧

| グループ | レイヤー数 | source-layer |
| --- | --- | --- |
| 背景 | 1 | — |
| 鉄道（地下・トンネル区間） | 2 | RailCL |
| 鉄道（線路・駅） | 41 | RailCL |
| 軌道（路面電車） | 2 | RailTrCL |
| 主要道路（高速道路・国道） | 2 | RdCL |
| 徒歩道・階段 | 2 | RdCL |
| 一般道路 | 20 | RdCL |
| 道路縁 | 1 | RdEdg |
| 道路構成線（トンネル・分離帯） | 2 | RdCompt |
| 建築物 | 10 | BldA |
| 水域（海・湖沼・河川面） | 1 | WA |
| 海岸線 | 2 | Cstline |
| 水涯線 | 2 | WL |
| 河川・水路 | 3 | RvrCL |
| 水部表記線 | 3 | WRltLine |
| 水部構造物（堤防・水門など） | 2 | WStrA, WStrL |
| 行政区画（面） | 1 | AdmArea |
| 行政界線 | 5 | AdmBdry |
| 等高線・等深線 | 4 | Cntr, Isbt |
| 地形表記（崖・岩・砂礫地など） | 2 | TpgphArea, TpgphLine |
| 構造物（擁壁・タンクなど） | 3 | StrctArea, StrctLine |
| 送電線 | 2 | PwrTrnsmL |
| 特定地区界 | 1 | SpcfArea |
| 注記（地名・施設名などの文字） | 9 | Anno |

> 等深線は `Cntr` ではなく `Isbt`（Isobath）で提供される。最初の分類ルールで
> 漏れたので `contour` グループに明示的に含めている。

## 表示の出し分け方

`experiments/01-.../apply.ts` が段階ごとに paint / layout を書き換える。

| 段階 | 不透明度 | 線幅 | 文字サイズ |
| --- | --- | --- | --- |
| 強調 (primary) | ×1.0 | ×2.2 | ×1.15 |
| 通常 (normal) | ×1.0 | ×1 | ×1 |
| 淡色 (muted) | ×0.25 | ×1 | ×1 |
| 非表示 (hidden) | `visibility: none` | — | — |

地理院スタイルの paint 値はズーム依存の式であることが多い。定数で上書きすると
ズームごとの調整が失われるため、`["*", 元の式, 係数]` で包む形にしている。

`fill` と `symbol` には線幅の概念がないので強調と通常の見た目は変わらない。
主役が面（水域・建築物など）のときは、周囲が淡色・非表示へ落ちることで
相対的に際立つという設計。

## 利用規約

国土地理院コンテンツ利用規約に従う。地図上に出典表示を入れている
（MapLibre の attribution）。

## 参考

- [地理院地図｜ベクトルタイルとその提供実験について](https://maps.gsi.go.jp/development/vt.html)
- [gsi-cyberjapan/optimal_bvmap](https://github.com/gsi-cyberjapan/optimal_bvmap)
