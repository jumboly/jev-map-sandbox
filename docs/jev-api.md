# Jev API 調査メモ

TypeSafe AI の System One モデル「Jev」をブラウザから呼ぶために調べた内容。
2026-09-20 時点の実地確認を含む。

## モデルの性格

- 文章を生成しない。**型付きの判断と確率分布**だけを返す。
- プリミティブは 3 つ。
  - `choice` — N 択から 1 つ。選択肢は 2〜255 個。
  - `score` — 順序付きレベルでの採点。レベルは 2〜10 個。返る `score` は確率加重の連続値で範囲は `0 〜 (レベル数 - 1)`。
  - `bool`（TypeSafe 直 API では `noul`、Vercel Gateway では `boolean`）— 記述が真である確率 0〜1。
- `questions` に複数並べると、**同じ `state` に対して互いに独立・並列**に評価される（fan-out）。
  1 リクエストで N 個の判断が同時に取れる。
- 料金は入力 100 万トークンあたり **$0.042**、出力は生成しないため無料。

## エンドポイント

### Vercel AI Gateway（本リポジトリの既定）

```
POST https://ai-gateway.vercel.sh/v4/ai/evaluation-model
Authorization: Bearer <Vercel AI Gateway API key>
Content-Type: application/json
ai-gateway-protocol-version: 0.0.1
ai-gateway-auth-method: api-key
ai-model-id: typesafe-ai/jev
```

ボディ:

```jsonc
{
  "state": "評価対象（文字列 / オブジェクト / 配列）",
  "questions": {
    "<任意のキー>": { "type": "score", "instructions": "...", "criteria": ["低", "中", "高"] }
  },
  "providerOptions": { "gateway": { "zeroDataRetention": true } } // 任意
}
```

モデル指定は**ボディではなくヘッダ** `ai-model-id` で行う。

> 公式 JS SDK が送る `ai-evaluation-model-specification-version` ヘッダは
> Gateway の CORS preflight で許可されていない。省略しても動作する。
> 本リポジトリの `shared/jev/client.ts` が SDK を使わず fetch を直書きしているのはこのため。

### TypeSafe 直 API

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TypeSafe API key>
```

ボディに `"model": "jev-latest"` を含める。`bool` は `noul` という型名になる。

**ブラウザからは原則呼べない。** 実測で preflight が拒否される:

```
$ curl -i -X OPTIONS https://api.typesafe.ai/v1/systemone \
    -H "Origin: https://example.github.io" \
    -H "Access-Control-Request-Method: POST"
HTTP/2 400
vary: Origin
access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT
...
Disallowed CORS origin
```

`vary: Origin` を返しつつ特定オリジンだけ通す許可リスト方式。`Origin` ヘッダを
付けない curl からは 403（キー未指定）まで到達するので、制限は CORS 層にある。
TypeSafe のコンソールでオリジンを登録できる場合のみ直 API が使える見込み。

### ブラウザから呼ぶときの落とし穴（実測）

Gateway の preflight は**任意のオリジンで通る**。`Origin` をそのままエコーバックする:

```
$ curl -i -X OPTIONS https://ai-gateway.vercel.sh/v4/ai/evaluation-model \
    -H "Origin: https://example.github.io" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: authorization,content-type,ai-model-id"
HTTP/2 200
access-control-allow-origin: https://example.github.io
access-control-allow-headers: Content-Type, Authorization, ai-gateway-auth-method,
  ai-gateway-protocol-version, ai-model-id, …
```

**ところが 401 などのエラー応答には `Access-Control-Allow-Origin` が付かない。**

```
$ curl -i -X POST … -H "Authorization: Bearer vck_dummy" -H "Origin: http://localhost:5173"
HTTP/2 401
content-type: application/json
(Access-Control-Allow-Origin なし)
{"error":{"message":"Authentication failed. …","type":"authentication_error"}}
```

そのため**ブラウザからは API キーが無効なときも `TypeError: Failed to fetch` になり、
通信障害と区別がつかない**。レスポンス本文も読めない。
`shared/jev/client.ts` は fetch の例外時に両方の可能性を示すメッセージを返している。

同じ理由で、TypeSafe 直 API の 403（キー未指定）にも ACAO は付かない。

## レスポンス

```jsonc
{
  "model": "jev-1.13.0",
  "answers": {
    "<質問キー>": {
      "type": "score",
      "score": 3.42,                  // 0 〜 レベル数-1
      "probabilities": { "0": 0.01, "1": 0.03, "2": 0.10, "3": 0.30, "4": 0.56 },
      "legend": { "0": "...", "4": "..." },
      "confidence": 0.56
    }
  },
  "usage": { "inputTokens": 1234, "outputTokens": 0 }
}
```

`choice` は `choice`（選ばれた名前）と `probabilities`、`bool` は `noul`（0〜1）を返す。
`confidence` が来ない場合は `probabilities` の最大値を最尤確率として代用できる。

## エラー

| ステータス | 内容 |
| --- | --- |
| 401 / 403 | API キー不正または未指定 |
| 422 | リクエストのバリデーション失敗 |
| 429 | レート制限。指数バックオフで再試行 |
| 529 | 過負荷。遅延後に再試行 |

## API キーの入手

- Vercel AI Gateway: Vercel ダッシュボード → AI Gateway → API Keys（`vck_…`）
- TypeSafe 直: `console.typesafe.ai`

## 参考

- [TypeSafe AI ドキュメント](https://docs.typesafe.ai/)
- [Vercel AI Gateway の Evaluation modality](https://vercel.com/docs/ai-gateway/modalities/evaluation)
- [terryds/jevplayground](https://github.com/terryds/jevplayground) — ブラウザのみで動く公開プレイグラウンド。Gateway 経由の実際の呼び出し方の参照元
