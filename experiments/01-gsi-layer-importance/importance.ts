import { JevClient, score, type JevResponse, type ScoreAnswer } from '@shared/jev'
import type { LayerGroup } from './catalog'
import type { MapView } from './map'

/**
 * 重要度の 5 段階。Jev の score プリミティブに渡す criteria であり、
 * 返る score は 0.0〜4.0 の確率加重値になる。
 * 「消してよい」から「主役」までを一直線に並べ、段階の境目を言葉で明確にする。
 */
export const IMPORTANCE_LEVELS = [
  '発話が求める表示とは無関係。非表示にしてよい。',
  '直接の関係はないが、背景として薄く残す価値がある。',
  '場所の文脈を保つために通常どおり表示すべき。',
  '発話の対象と関連が深く、はっきり見せるべき。',
  '発話が名指しした主役。最も強調すべき。',
] as const

export const MAX_IMPORTANCE = IMPORTANCE_LEVELS.length - 1

export type Tier = 'primary' | 'normal' | 'muted' | 'hidden'

export interface GroupVerdict {
  group: LayerGroup
  /** 0.0〜4.0。Jev が返す確率加重スコア。 */
  score: number
  /** 最尤レベルの確率。低い場合は人間が確認したほうがよい。 */
  confidence: number
  tier: Tier
}

export interface JudgementResult {
  utterance: string
  verdicts: GroupVerdict[]
  usage: JevResponse['usage']
  latencyMs: number
  model?: string
}

/** スコアの境目。段階的に表示を弱めていくための閾値。 */
const TIER_THRESHOLDS: ReadonlyArray<{ min: number; tier: Tier }> = [
  { min: 3.2, tier: 'primary' },
  { min: 2.2, tier: 'normal' },
  { min: 1.2, tier: 'muted' },
  { min: -Infinity, tier: 'hidden' },
]

export const toTier = (value: number): Tier =>
  TIER_THRESHOLDS.find((t) => value >= t.min)!.tier

export const TIER_LABELS: Record<Tier, string> = {
  primary: '強調',
  normal: '通常',
  muted: '淡色',
  hidden: '非表示',
}

/**
 * Jev のキーに使えるよう、グループ ID をそのまま質問キーにする。
 * questions は同じ state に対して独立・並列に評価されるので、
 * 1 リクエストで全グループ分の重要度がまとめて返る（fan-out パターン）。
 */
export async function judgeLayers(
  client: JevClient,
  utterance: string,
  groups: LayerGroup[],
  view: MapView,
  signal?: AbortSignal,
): Promise<JudgementResult> {
  const state = {
    発話: utterance,
    地図の状態: {
      ズームレベル: view.zoom,
      中心座標: [view.center.lng, view.center.lat],
    },
    説明:
      'ユーザーが地図に対して口頭で出した指示です。各質問は地理院地図のレイヤーグループ 1 つについて、' +
      'この指示を満たす表示にするうえでどれだけ重要かを尋ねています。',
  }

  const questions = Object.fromEntries(
    groups.map((g) => [
      g.id,
      score(
        `レイヤーグループ「${g.label}」（${g.description}）は、この発話が求める地図表示にとってどれだけ重要か。`,
        [...IMPORTANCE_LEVELS],
      ),
    ]),
  )

  const res = await client.evaluate(state, questions, { signal })

  const verdicts: GroupVerdict[] = groups.map((group) => {
    const answer = res.answers[group.id] as ScoreAnswer | undefined
    // 回答が欠けたグループは「通常表示」に倒し、地図が壊れないようにする
    const value = typeof answer?.score === 'number' ? answer.score : 2
    return {
      group,
      score: value,
      confidence: topProbability(answer),
      tier: toTier(value),
    }
  })

  return {
    utterance,
    verdicts,
    usage: res.usage,
    latencyMs: res.latencyMs ?? 0,
    model: res.model,
  }
}

function topProbability(answer: ScoreAnswer | undefined): number {
  if (typeof answer?.confidence === 'number') return answer.confidence
  const probs = answer?.probabilities
  if (!probs) return 1
  const values = Object.values(probs)
  return values.length ? Math.max(...values) : 1
}
