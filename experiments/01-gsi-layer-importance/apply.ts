import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import type { GroupVerdict, Tier } from './importance'
import type { LayerGroup } from './catalog'

/**
 * 段階ごとの見た目。
 *
 * opacity は「元の値 × 係数」で掛け合わせる。地理院スタイルの paint 値は
 * ズーム依存の式であることが多く、定数で上書きするとズームごとの調整が
 * すべて失われるため、式を ["*", 元の式, 係数] で包む形にしている。
 *
 * fill と symbol には太さの概念がないので primary と normal の差は出ない。
 * 主役が面のときは周囲が muted / hidden に落ちることで相対的に際立つ。
 */
const TIER_STYLE: Record<Exclude<Tier, 'hidden'>, { opacity: number; width: number; textSize: number }> = {
  primary: { opacity: 1, width: 2.2, textSize: 1.15 },
  normal: { opacity: 1, width: 1, textSize: 1 },
  muted: { opacity: 0.25, width: 1, textSize: 1 },
}

/** レイヤー種別ごとの不透明度プロパティ。symbol は文字とアイコンの 2 系統ある。 */
const OPACITY_PROPS: Record<string, string[]> = {
  line: ['line-opacity'],
  fill: ['fill-opacity'],
  symbol: ['text-opacity', 'icon-opacity'],
  background: ['background-opacity'],
  circle: ['circle-opacity'],
}

interface BaseLayer {
  type: string
  paint: Record<string, unknown>
  layout: Record<string, unknown>
}

export class LayerStyler {
  private readonly base = new Map<string, BaseLayer>()

  constructor(
    private readonly map: MapLibreMap,
    baseStyle: StyleSpecification,
  ) {
    for (const layer of baseStyle.layers) {
      this.base.set(layer.id, {
        type: layer.type,
        paint: { ...((layer as { paint?: Record<string, unknown> }).paint ?? {}) },
        layout: { ...((layer as { layout?: Record<string, unknown> }).layout ?? {}) },
      })
    }
  }

  /** 判断結果を地図に反映する。 */
  apply(verdicts: GroupVerdict[]): void {
    for (const verdict of verdicts) {
      this.applyTier(verdict.group, verdict.tier)
    }
  }

  applyTier(group: LayerGroup, tier: Tier): void {
    for (const layerId of group.layerIds) {
      if (!this.map.getLayer(layerId)) continue
      const base = this.base.get(layerId)
      if (!base) continue

      if (tier === 'hidden') {
        this.map.setLayoutProperty(layerId, 'visibility', 'none')
        continue
      }

      this.map.setLayoutProperty(layerId, 'visibility', 'visible')
      const style = TIER_STYLE[tier]

      for (const prop of OPACITY_PROPS[base.type] ?? []) {
        this.map.setPaintProperty(layerId, prop, scale(base.paint[prop], style.opacity, 1) as never)
      }
      if (base.type === 'line') {
        this.map.setPaintProperty(
          layerId,
          'line-width',
          scale(base.paint['line-width'], style.width, 1) as never,
        )
      }
      if (base.type === 'symbol' && style.textSize !== 1) {
        this.map.setLayoutProperty(
          layerId,
          'text-size',
          scale(base.layout['text-size'], style.textSize, 16) as never,
        )
      }
    }
  }

  /** 全レイヤーを地理院スタイル本来の見た目に戻す。 */
  reset(): void {
    for (const [layerId, base] of this.base) {
      if (!this.map.getLayer(layerId)) continue
      this.map.setLayoutProperty(layerId, 'visibility', base.layout['visibility'] ?? 'visible')
      for (const prop of OPACITY_PROPS[base.type] ?? []) {
        this.map.setPaintProperty(layerId, prop, (base.paint[prop] ?? null) as never)
      }
      if (base.type === 'line') {
        this.map.setPaintProperty(layerId, 'line-width', (base.paint['line-width'] ?? null) as never)
      }
      if (base.type === 'symbol') {
        this.map.setLayoutProperty(layerId, 'text-size', (base.layout['text-size'] ?? null) as never)
      }
    }
  }
}

/**
 * 元の値に係数を掛ける。未設定なら MapLibre の既定値を基準にする。
 * 係数 1 のときは式を増やさずそのまま返す。
 */
function scale(original: unknown, factor: number, fallback: number): unknown {
  if (factor === 1) return original ?? null
  if (original === undefined || original === null) return fallback * factor
  if (typeof original === 'number') return original * factor
  return ['*', original, factor]
}
