/**
 * TypeSafe AI の System One モデル (Jev) の型定義。
 *
 * Jev は文章を生成せず「型付きの判断 + 確率分布」だけを返す。
 * 3 つのプリミティブ (choice / score / bool) があり、questions に複数並べると
 * 同じ state に対して互いに独立・並列に評価される (fan-out パターン)。
 */

/** 評価対象。文字列でも構造化オブジェクトでもよい。 */
export type JevState = string | Record<string, unknown> | unknown[]

/** N 択から 1 つ選ぶ。criteria は「選択肢名 -> 説明 (省略時 null)」。 */
export interface ChoiceQuestion {
  type: 'choice'
  instructions: string
  criteria: Record<string, string | null>
}

/** 順序付きレベルで採点する。criteria は低い順のレベル説明の配列 (2〜10 個)。 */
export interface ScoreQuestion {
  type: 'score'
  instructions: string
  criteria: string[]
}

/** 真偽の確率 (0〜1) を返す。TypeSafe 直 API では "noul" と呼ばれる型。 */
export interface BoolQuestion {
  type: 'bool'
  instructions: string
  criteria?: { true?: string; false?: string }
}

export type JevQuestion = ChoiceQuestion | ScoreQuestion | BoolQuestion

export interface ChoiceAnswer {
  type: 'choice'
  choice: string
  probabilities?: Record<string, number>
  confidence?: number
}

export interface ScoreAnswer {
  type: 'score'
  /** レベル確率で重み付けされた連続値。0 〜 (criteria.length - 1)。 */
  score: number
  probabilities?: Record<string, number>
  legend?: Record<string, string>
  confidence?: number
}

export interface BoolAnswer {
  type: 'bool'
  /** 記述が真である確率 (0〜1)。 */
  noul: number
  confidence?: number
}

export type JevAnswer = ChoiceAnswer | ScoreAnswer | BoolAnswer

export interface JevUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface JevResponse<K extends string = string> {
  model?: string
  answers: Record<K, JevAnswer>
  usage?: JevUsage
  /** 実測レイテンシ (ms)。クライアント側で付与する。 */
  latencyMs?: number
}

/**
 * 接続先。
 *
 * TypeSafe 直 API (api.typesafe.ai) は CORS オリジンが許可制で、
 * 未登録オリジンからのブラウザ呼び出しは preflight で弾かれる
 * (`Disallowed CORS origin`)。GitHub Pages から動かす本リポジトリでは
 * CORS が開いている Vercel AI Gateway を既定にしている。
 */
export type JevTransport = 'vercel-gateway' | 'typesafe-direct'

export class JevError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'JevError'
  }
}
