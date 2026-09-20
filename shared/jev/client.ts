import {
  JevError,
  type JevQuestion,
  type JevResponse,
  type JevState,
  type JevTransport,
} from './types'

const ENDPOINTS: Record<JevTransport, string> = {
  'vercel-gateway': 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model',
  'typesafe-direct': 'https://api.typesafe.ai/v1/systemone',
}

const GATEWAY_MODEL_ID = 'typesafe-ai/jev'
const DIRECT_MODEL = 'jev-latest'

export interface JevClientOptions {
  apiKey: string
  transport?: JevTransport
  /** Vercel AI Gateway の Zero Data Retention を有効にする。 */
  zeroDataRetention?: boolean
  fetchImpl?: typeof fetch
}

export interface EvaluateOptions {
  signal?: AbortSignal
}

/**
 * ブラウザから Jev を直接呼ぶ最小クライアント。
 *
 * 公式 JS SDK (@typesafe-ai/sdk) は Node 20+ 前提でブラウザ利用が明記されて
 * おらず、Gateway 経由では SDK が送る ai-evaluation-model-specification-version
 * ヘッダが CORS preflight で許可されない。そのため fetch を直接組み立てている。
 */
export class JevClient {
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: JevClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  get transport(): JevTransport {
    return this.options.transport ?? 'vercel-gateway'
  }

  async evaluate<K extends string>(
    state: JevState,
    questions: Record<K, JevQuestion>,
    opts: EvaluateOptions = {},
  ): Promise<JevResponse<K>> {
    const direct = this.transport === 'typesafe-direct'
    const body: Record<string, unknown> = {
      state,
      questions: serializeQuestions(questions, direct),
    }
    if (direct) body.model = DIRECT_MODEL
    if (!direct && this.options.zeroDataRetention) {
      body.providerOptions = { gateway: { zeroDataRetention: true } }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiKey}`,
      'Content-Type': 'application/json',
    }
    if (!direct) {
      headers['ai-gateway-protocol-version'] = '0.0.1'
      headers['ai-gateway-auth-method'] = 'api-key'
      headers['ai-model-id'] = GATEWAY_MODEL_ID
    }

    const started = performance.now()
    let res: Response
    try {
      res = await this.fetchImpl(ENDPOINTS[this.transport], {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: opts.signal,
      })
    } catch (cause) {
      // Gateway は 4xx のエラー応答に Access-Control-Allow-Origin を付けない。
      // そのため API キーが無効なときもブラウザからは通信断と同じ TypeError になり、
      // レスポンス本文を読む手段がない。ここで両方の可能性を伝えておく。
      const hint = direct
        ? 'TypeSafe 直 API は CORS オリジンが許可制です。Vercel AI Gateway 経由に切り替えてください。'
        : 'API キーが無効・権限不足の場合もこのエラーになります（Gateway はエラー応答に CORS ヘッダを返さないため、'
          + 'ブラウザが本文を読めません）。キーを確認しても直らない場合は、通信環境や拡張機能によるブロックを疑ってください。'
      throw new JevError(`Jev に到達できませんでした。${hint} (${String(cause)})`)
    }
    const latencyMs = performance.now() - started

    const text = await res.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      // JSON でないエラー本文はそのまま message に載せる
    }

    if (!res.ok) {
      throw new JevError(errorMessage(res, json, text), res.status, json ?? text)
    }
    const parsed = json as JevResponse<K> | null
    if (!parsed || typeof parsed.answers !== 'object' || parsed.answers === null) {
      throw new JevError('answers を含まないレスポンスが返りました。', res.status, json ?? text)
    }

    return {
      ...parsed,
      answers: deserializeAnswers(parsed.answers) as JevResponse<K>['answers'],
      latencyMs,
    }
  }
}

/**
 * 内部表現の bool を各エンドポイントの呼称に合わせる。
 * Gateway は "boolean"、TypeSafe 直 API は "noul" を受け付ける。
 */
function serializeQuestions(
  questions: Record<string, JevQuestion>,
  direct: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, q] of Object.entries(questions)) {
    out[key] = q.type === 'bool' ? { ...q, type: direct ? 'noul' : 'boolean' } : q
  }
  return out
}

/** レスポンス側の "boolean" / "noul" も内部表現の bool に戻す。 */
function deserializeAnswers(answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, a] of Object.entries(answers)) {
    const answer = a as { type?: string }
    out[key] =
      answer?.type === 'boolean' || answer?.type === 'noul'
        ? { ...answer, type: 'bool' }
        : answer
  }
  return out
}

function errorMessage(res: Response, json: unknown, text: string): string {
  const j = json as
    | { error?: { message?: string; type?: string }; detail?: { message?: string }; message?: string }
    | null
  const detail =
    j?.error?.message ?? j?.detail?.message ?? j?.message ?? (text || res.statusText)
  if (res.status === 401 || res.status === 403) {
    return `認証に失敗しました (${res.status})。API キーを確認してください。\n${detail}`
  }
  if (res.status === 429) {
    return `レート制限に達しました (429)。少し待って再試行してください。\n${detail}`
  }
  return `Jev がエラーを返しました (${res.status})。\n${detail}`
}
