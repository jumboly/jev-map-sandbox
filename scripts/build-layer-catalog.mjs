/**
 * 地理院地図Vector（最適化ベクトルタイル・標準地図風スタイル）のスタイル定義から
 * 「意味のあるレイヤーグループ」のカタログを生成する。
 *
 * スタイル定義の 123 レイヤーは描画順を作るための機械的な分割
 * （例: 鉄道中心線0〜4、鉄道中心線橋ククリ白0〜4）を多く含む。
 * これをそのまま Jev に渡すと質問数と入力トークンが無駄に増え、
 * 「鉄道を強調して」に対する判断も分散してしまう。
 * そこで人間が地図を語るときの粒度（鉄道／道路／建物／注記…）へ畳んでおく。
 *
 * 実行: npm run catalog:gsi
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const STYLE_URL = 'https://gsi-cyberjapan.github.io/optimal_bvmap/style/std.json'
const OUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../public/data/gsi-layer-catalog.json',
)

/**
 * グループ定義。上から順に評価し、最初に match したグループへレイヤーを割り当てる。
 * より具体的な条件（地下トンネル等）を先に置くこと。
 *
 * description は Jev への入力そのものなので、
 * 「何が描かれるか」と「どんな発話と結びつくか」が読み取れる日本語にする。
 */
const GROUPS = [
  {
    id: 'background',
    label: '背景',
    description: '地図全体の下地の塗り。これを消すと地図が成立しない。',
    // 下地は判断対象にしない（消えると地図が破綻するため常に表示）
    alwaysVisible: true,
    match: (l) => l.id === 'background',
  },
  {
    id: 'railway-tunnel',
    label: '鉄道（地下・トンネル区間）',
    description: '鉄道路線のうち地下鉄やトンネル内を通る区間の中心線。地上の線路とは別に描かれる。',
    match: (l) => /^鉄道中心線地下トンネル/.test(l.id),
  },
  {
    id: 'railway',
    label: '鉄道（線路・駅）',
    description:
      'JR・私鉄など鉄道路線の中心線と、駅部分のククリ（駅を示す白抜き表現）、橋梁区間の線路。「電車」「路線」「駅」「線路」に相当する地図要素。',
    match: (l) => /^鉄道中心線/.test(l.id),
  },
  {
    id: 'tramway',
    label: '軌道（路面電車）',
    description: '路面電車・軌道の中心線。道路上を走る鉄道であり、鉄道とは別レイヤー。',
    match: (l) => /^軌道の中心線/.test(l.id),
  },
  {
    id: 'road-major',
    label: '主要道路（高速道路・国道）',
    description:
      '広域ズームでも表示される高速道路と国道の中心線。都市間の移動や幹線のつながりを表す。',
    match: (l) => /^道路中心線ZL4-10/.test(l.id),
  },
  {
    id: 'road-path',
    label: '徒歩道・階段',
    description: '車が通れない細い道や階段。歩行者向けの経路を表す。',
    match: (l) => /^道路中心線(破線|階段)/.test(l.id),
  },
  {
    id: 'road',
    label: '一般道路',
    description:
      '市街地を含む一般的な道路の中心線と橋梁区間。地図の骨格になる最も密度の高い線群。',
    match: (l) => /^道路中心線/.test(l.id),
  },
  {
    id: 'road-edge',
    label: '道路縁',
    description: '道路の両端を示す細線。大縮尺で道路の幅を表現する。',
    match: (l) => l['source-layer'] === 'RdEdg',
  },
  {
    id: 'road-structure',
    label: '道路構成線（トンネル・分離帯）',
    description: '道路のトンネル区間や中央分離帯を示す線。',
    match: (l) => l['source-layer'] === 'RdCompt',
  },
  {
    id: 'building',
    label: '建築物',
    description:
      '建物の輪郭ポリゴンと外周線。市街地の密度や街区の形を表し、都市部では面積の大半を占める。',
    match: (l) => l['source-layer'] === 'BldA',
  },
  {
    id: 'water-area',
    label: '水域（海・湖沼・河川面）',
    description: '海、湖、池、幅のある河川の水面を示す塗り。海岸線の内外を決める基準になる。',
    match: (l) => l['source-layer'] === 'WA',
  },
  {
    id: 'coastline',
    label: '海岸線',
    description: '海と陸の境界線。日本の地図で最も認識しやすい輪郭。',
    match: (l) => l['source-layer'] === 'Cstline',
  },
  {
    id: 'waterline',
    label: '水涯線',
    description: '湖沼や河川の水際を示す線。海岸線以外の水と陸の境界。',
    match: (l) => l['source-layer'] === 'WL',
  },
  {
    id: 'river',
    label: '河川・水路',
    description:
      '河川と人工水路の中心線（地下水路・枯れ川を含む）。幅の狭い川は面ではなく線で描かれる。',
    match: (l) => l['source-layer'] === 'RvrCL',
  },
  {
    id: 'water-label-line',
    label: '水部表記線',
    description: '滝、せき、水流方向など水部に付随する補助的な記号・線。',
    match: (l) => l['source-layer'] === 'WRltLine',
  },
  {
    id: 'water-structure',
    label: '水部構造物（堤防・水門など）',
    description: '堤防、水門、ダムなど水に関わる人工構造物。',
    match: (l) => l['source-layer'] === 'WStrA' || l['source-layer'] === 'WStrL',
  },
  {
    id: 'admin-area',
    label: '行政区画（面）',
    description: '市区町村などの行政区域の塗り。陸地の下地としても働く。',
    match: (l) => l['source-layer'] === 'AdmArea',
  },
  {
    id: 'admin-boundary',
    label: '行政界線（都道府県・市区町村界）',
    description:
      '都道府県界、市区町村界、地方界などの境界線。行政のまとまりを示すが地形とは無関係。',
    match: (l) => l['source-layer'] === 'AdmBdry',
  },
  {
    id: 'contour',
    label: '等高線・等深線',
    description:
      '標高および水深を示す等値線とその数値注記。地形の起伏を読むための情報で、線の本数が非常に多い。',
    // 等深線は Isbt (Isobath) で提供され Cntr とは別の source-layer になる
    match: (l) => l['source-layer'] === 'Cntr' || l['source-layer'] === 'Isbt',
  },
  {
    id: 'terrain',
    label: '地形表記（崖・岩・砂礫地など）',
    description: '崖、岩、雨裂、砂礫地など自然地形の面と線による表現。',
    match: (l) =>
      l['source-layer'] === 'TpgphArea' || l['source-layer'] === 'TpgphLine',
  },
  {
    id: 'structure',
    label: '構造物（擁壁・タンクなど）',
    description: '擁壁、タンク、高塔など建築物以外の人工構造物。',
    match: (l) =>
      l['source-layer'] === 'StrctArea' || l['source-layer'] === 'StrctLine',
  },
  {
    id: 'powerline',
    label: '送電線',
    description: '高圧送電線の経路。電力インフラを表す。',
    match: (l) => l['source-layer'] === 'PwrTrnsmL',
  },
  {
    id: 'special-area',
    label: '特定地区界',
    description: '国立公園や自然環境保全地域などの特定地区の境界。',
    match: (l) => l['source-layer'] === 'SpcfArea',
  },
  {
    id: 'annotation',
    label: '注記（地名・施設名などの文字）',
    description:
      '地名、駅名、施設名、道路番号などの文字ラベルとシンボル。これを消すと場所の同定が難しくなる。',
    match: (l) => l['source-layer'] === 'Anno',
  },
]

function classify(layer) {
  return GROUPS.find((g) => g.match(layer)) ?? null
}

async function main() {
  console.log(`スタイル定義を取得: ${STYLE_URL}`)
  const res = await fetch(STYLE_URL)
  if (!res.ok) throw new Error(`スタイル取得に失敗: ${res.status} ${res.statusText}`)
  const style = await res.json()

  const buckets = new Map(GROUPS.map((g) => [g.id, []]))
  const unmatched = []

  for (const layer of style.layers) {
    const group = classify(layer)
    if (!group) {
      unmatched.push(layer.id)
      continue
    }
    buckets.get(group.id).push(layer)
  }

  if (unmatched.length) {
    // 未分類があるとそのレイヤーは Jev の判断対象外のまま残り続けるため必ず気付けるようにする
    console.warn(`未分類のレイヤーが ${unmatched.length} 件あります:`, unmatched)
  }

  const groups = GROUPS.map((g) => {
    const layers = buckets.get(g.id)
    return {
      id: g.id,
      label: g.label,
      description: g.description,
      alwaysVisible: g.alwaysVisible === true,
      layerIds: layers.map((l) => l.id),
      layerTypes: [...new Set(layers.map((l) => l.type))].sort(),
      sourceLayers: [...new Set(layers.map((l) => l['source-layer']).filter(Boolean))].sort(),
    }
  }).filter((g) => g.layerIds.length > 0)

  const catalog = {
    generatedAt: new Date().toISOString(),
    styleUrl: STYLE_URL,
    styleName: style.name ?? null,
    totalLayers: style.layers.length,
    groups,
  }

  await mkdir(dirname(OUT_PATH), { recursive: true })
  await writeFile(OUT_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf-8')

  console.log(`\n${style.layers.length} レイヤー -> ${groups.length} グループ`)
  for (const g of groups) {
    console.log(`  ${String(g.layerIds.length).padStart(3)}  ${g.id.padEnd(18)} ${g.label}`)
  }
  console.log(`\n出力: ${OUT_PATH}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
