import { JevClient, score, type JevResponse, type ScoreAnswer } from '@shared/jev'
import type { LayerGroup } from './catalog'
import type { MapView } from './map'

/**
 * 表示の強さ 5 段階。Jev の score プリミティブに渡す criteria であり、
 * 返る score は 0.0〜4.0 の確率加重値になる。
 *
 * 軸は「重要度」ではなく「地図上でどう扱うか」。
 * 重要度で尋ねると「鉄道を非表示にして」のような除外指示が破綻する。
 * 名指しされた要素は消す対象であっても発話との関連は最も深く、
 * 「重要か」と訊かれれば低く振り切れないためである。
 * そこでレベル 0 に「取り除くことを求めている」を明示し、
 * 除外指示と無関係な要素の両方が最下段に落ちるようにしている。
 */
export const TREATMENT_LEVELS = [
  '発話はこの要素を地図から取り除くよう求めている。または発話の目的にとって全く不要。地図から消す。',
  '発話が求めるものではない。邪魔にならないよう薄くする。',
  '発話は言及していないが、場所を見失わないために通常どおり残す。',
  '発話が求める内容に直接関わる。はっきり見せる。',
  '発話が名指しして見せるよう求めた主役。最も強調する。',
] as const

export const MAX_LEVEL = TREATMENT_LEVELS.length - 1

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
      'この指示を実行した結果としてその要素を地図上でどう扱うべきかを尋ねています。' +
      '指示がある要素を消す・隠す・不要だと述べている場合、その要素は最も低いレベルになります。' +
      '指示に含まれる言葉と関連が深いことは、その要素を見せるべき理由にはなりません。',
  }

  const questions = Object.fromEntries(
    groups.map((g) => [
      g.id,
      score(
        `この発話を実行したとき、レイヤーグループ「${g.label}」（${g.description}）を地図上でどう扱うべきか。`,
        [...TREATMENT_LEVELS],
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
