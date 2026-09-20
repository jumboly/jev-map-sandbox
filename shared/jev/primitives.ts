import type { BoolQuestion, ChoiceQuestion, ScoreQuestion } from './types'

/** N 択の質問を組み立てる。選択肢は 2 個以上 255 個以下。 */
export function choice(
  instructions: string,
  criteria: Record<string, string | null>,
): ChoiceQuestion {
  return { type: 'choice', instructions, criteria }
}

/** 段階評価の質問を組み立てる。レベルは低い順に 2〜10 個。 */
export function score(instructions: string, levels: string[]): ScoreQuestion {
  return { type: 'score', instructions, criteria: levels }
}

/** 真偽確率の質問を組み立てる。 */
export function bool(
  instructions: string,
  criteria?: { true?: string; false?: string },
): BoolQuestion {
  return { type: 'bool', instructions, criteria }
}
