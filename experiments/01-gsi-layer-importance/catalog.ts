/** scripts/build-layer-catalog.mjs が生成する gsi-layer-catalog.json の型。 */
export interface LayerGroup {
  id: string
  label: string
  description: string
  /** true のグループは判断対象にせず常に表示する（消すと地図が破綻するため）。 */
  alwaysVisible: boolean
  layerIds: string[]
  layerTypes: string[]
  sourceLayers: string[]
}

export interface LayerCatalog {
  generatedAt: string
  styleUrl: string
  styleName: string | null
  totalLayers: number
  groups: LayerGroup[]
}

export async function loadCatalog(url: string): Promise<LayerCatalog> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`レイヤーカタログを読み込めませんでした (${res.status})`)
  }
  return (await res.json()) as LayerCatalog
}

/** Jev に判断させる対象のグループ（背景など常時表示のものを除く）。 */
export const judgeableGroups = (catalog: LayerCatalog): LayerGroup[] =>
  catalog.groups.filter((g) => !g.alwaysVisible)
