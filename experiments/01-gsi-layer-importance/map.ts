import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl'

/**
 * 地理院地図Vector（最適化ベクトルタイル・標準地図風スタイル）。
 * sprite / glyphs / タイルのいずれも Access-Control-Allow-Origin: * のため
 * GitHub Pages から直接参照できる。
 */
const STYLE_URL = 'https://gsi-cyberjapan.github.io/optimal_bvmap/style/std.json'

/**
 * 公式スタイルの tiles は pmtiles:// プロトコルを指しており、そのままでは
 * pmtiles ライブラリの登録が要る。同じデータが XYZ でも配信されているので、
 * 依存を増やさないようこちらへ差し替える。
 */
const XYZ_TILES = 'https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/{z}/{x}/{y}.pbf'

const ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院 最適化ベクトルタイル</a>'

export interface MapBundle {
  map: MapLibreMap
  /** 判断適用前の paint を戻せるよう、元のスタイル定義を保持しておく。 */
  baseStyle: StyleSpecification
}

export async function createMap(container: HTMLElement): Promise<MapBundle> {
  const res = await fetch(STYLE_URL)
  if (!res.ok) throw new Error(`地理院地図のスタイル定義を取得できませんでした (${res.status})`)
  const style = (await res.json()) as StyleSpecification

  const source = style.sources['v']
  if (source && source.type === 'vector') {
    source.tiles = [XYZ_TILES]
    delete (source as { url?: string }).url
    source.attribution = ATTRIBUTION
  }

  const map = new maplibregl.Map({
    container,
    style,
    // 東京駅周辺。鉄道・道路・建物が密で、レイヤーの出し分けが目で見て分かる
    center: [139.7671, 35.6812],
    zoom: 13,
    hash: true,
    attributionControl: { compact: true },
  })
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left')
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left')

  await new Promise<void>((resolve) => {
    map.once('load', () => resolve())
  })

  return { map, baseStyle: style }
}

export interface MapView {
  zoom: number
  center: { lng: number; lat: number }
}

export const readView = (map: MapLibreMap): MapView => ({
  zoom: Math.round(map.getZoom() * 10) / 10,
  center: {
    lng: Math.round(map.getCenter().lng * 10000) / 10000,
    lat: Math.round(map.getCenter().lat * 10000) / 10000,
  },
})
