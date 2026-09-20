# jev-map-sandbox

TypeSafe AI の System One モデル **[Jev](https://docs.typesafe.ai/)** を地図に使ってみる実験場。

Jev は文章を生成せず、**型付きの判断と確率**（`choice` / `score` / `bool`）だけを返す。
地図は「どのレイヤーを残すか」「何がいま重要か」という判断の塊なので、相性を試す題材として選んだ。

完成品ではなく、試して結果を残す場所。うまくいかなかったことも `docs/` に書いてある。

## 方針

| | |
| --- | --- |
| 実行環境 | ブラウザのみ。**サーバーサイドは持たない** |
| 配信 | GitHub Pages（`main` への push で自動デプロイ） |
| API キー | ユーザーがブラウザ上で入力する。既定ではメモリのみ、明示的に選んだときだけ `localStorage` |
| 接続先 | Vercel AI Gateway 経由（`api.typesafe.ai` は CORS オリジン許可制のためブラウザから直接は呼べない。→ [docs/jev-api.md](docs/jev-api.md)） |

## 実験

| # | 実験 | 使う Jev プリミティブ | 題材 |
| --- | --- | --- | --- |
| 01 | [音声指示による地図レイヤーの重要度分類](experiments/01-gsi-layer-importance/) | `score` | 地理院地図Vector + MapLibre GL JS + Web Speech API |

### 01 — 音声指示による地図レイヤーの重要度分類

ブラウザの音声入力で「鉄道を強調表示して」と話すと、

1. 地理院地図Vector のスタイル定義（**123 レイヤー**）を事前に解析して作った
   **24 グループ**のカタログ（[`public/data/gsi-layer-catalog.json`](public/data/gsi-layer-catalog.json)）を読み込み、
2. 発話を `state`、各グループを 1 問ずつの `score` 質問として **1 リクエストで並列採点**し、
3. 0.0〜4.0 のスコアを **強調 / 通常 / 淡色 / 非表示**の 4 段階に落として地図に反映する。

判定は 1 行ずつ確信度つきで表示され、その場で手動上書きもできる
（Jev の判断と自分の意図がどうずれるかを見るため）。

## フォルダ構成

```
jev-map-sandbox/
├── index.html                      # 実験一覧のポータル（Pages のルート）
├── vite.config.ts                  # experiments/*/index.html を自動で入力に加える
├── shared/                         # 実験をまたいで使い回すコード
│   ├── jev/                        #   Jev クライアント（fetch 直書き・Gateway / 直 API 両対応）
│   ├── voice/                      #   Web Speech API ラッパ
│   ├── ui/                         #   API キーの保持など
│   └── styles/base.css             #   共通のダークテーマ
├── experiments/
│   └── 01-gsi-layer-importance/    # 実験 1 つ = 1 ディレクトリ = 1 ページ
│       ├── index.html
│       ├── main.ts                 #   UI の配線
│       ├── catalog.ts              #   レイヤーカタログの型と読み込み
│       ├── map.ts                  #   MapLibre + 地理院地図Vector の初期化
│       ├── importance.ts           #   Jev への質問組み立てと判定
│       └── apply.ts                #   判定結果を地図の見た目へ反映
├── scripts/
│   └── build-layer-catalog.mjs     # スタイル定義 → レイヤーグループのカタログ生成
├── public/data/                    # 生成物（そのまま配信される）
├── docs/                           # 調査メモ・設計の記録
└── .github/workflows/              # CI と Pages デプロイ
```

実験ごとに npm プロジェクトを分けず、**1 つの Vite マルチページ構成**にしている。
実験を増やすときは `experiments/<番号>-<名前>/index.html` を足すだけで
ビルド対象に入り、共有コードは `@shared/*` でそのまま使える。

## 使い方

```bash
npm install
npm run dev            # http://localhost:5173/
```

ブラウザで開いたら、右のパネルに **Vercel AI Gateway の API キー**（`vck_…`）を入力する。
キーは [Vercel ダッシュボード → AI Gateway → API Keys](https://vercel.com/d?to=%2F%5Bteam%5D%2F~%2Fai-gateway%2Fapi-keys) で発行できる。

音声入力は Chrome / Edge / Safari で動く。非対応のブラウザではテキスト入力を使う。

> **注意**: Gateway は 401 などのエラー応答に CORS ヘッダを返さないため、
> API キーが間違っていてもブラウザ上は「Jev に到達できませんでした」という
> 通信エラーとして見える。まずキーを疑うこと。詳細は [docs/jev-api.md](docs/jev-api.md)。

### その他のコマンド

```bash
npm run typecheck      # tsc --noEmit
npm run build          # 型チェック + Vite ビルド（dist/）
npm run preview        # ビルド結果をローカル配信
npm run catalog:gsi    # 地理院地図のスタイル定義からレイヤーカタログを再生成
```

## 実験を増やすとき

1. `experiments/<番号>-<名前>/` を作り、`index.html` と `main.ts` を置く
2. ルートの `index.html` にカードを 1 枚足す
3. Jev の呼び出しは `@shared/jev` の `JevClient` と `choice()` / `score()` / `bool()` を使う

```ts
import { JevClient, choice } from '@shared/jev'

const client = new JevClient({ apiKey, transport: 'vercel-gateway' })
const res = await client.evaluate(
  { 問い合わせ: '終電の時間が知りたい' },
  { 種別: choice('この問い合わせの種別は？', { 運行情報: null, 料金: null, その他: null }) },
)
res.answers.種別 // => { type: 'choice', choice: '運行情報', probabilities: {...} }
```

## 今後試したいこと

- **候補事前フィルタ方式**（実験 01 の別案）: スタイル定義から発話に関係しそうな
  レイヤー候補を機械的に絞り、`choice` で 1 つ選ばせる。トークンは減るが表現力も落ちるはずで、
  重要度分類方式との比較材料になる。
- 判定結果のキャッシュ。同じ発話・同じ地図状態なら再問い合わせを省く。
- `bool` を使った段階的な絞り込み（「この発話は特定の地物を名指ししているか？」で分岐）。

## ライセンスと出典

地図データは [国土地理院 最適化ベクトルタイル](https://maps.gsi.go.jp/development/ichiran.html)。
国土地理院コンテンツ利用規約に従う。
