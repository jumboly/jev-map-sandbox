import './style.css'
import { JevClient, JevError, type JevTransport } from '@shared/jev'
import { loadSettings, persistSettings } from '@shared/ui/api-key'
import { VoiceInput, isSpeechRecognitionSupported } from '@shared/voice/speech'
import { judgeableGroups, loadCatalog, type LayerCatalog } from './catalog'
import { createMap, readView } from './map'
import { LayerStyler } from './apply'
import {
  MAX_LEVEL,
  TIER_LABELS,
  judgeLayers,
  toTier,
  type GroupVerdict,
  type JudgementResult,
  type Tier,
} from './importance'

const INPUT_USD_PER_TOKEN = 0.042 / 1e6

const EXAMPLES = [
  '鉄道を強調表示して',
  '鉄道だけ残して他は消して',
  '川と海岸線を目立たせて',
  '建物を消して道路だけにして',
  '等高線で地形を読みたい',
  '地名がわかればいい',
]

const TRANSPORT_HINTS: Record<JevTransport, string> = {
  'vercel-gateway':
    'Vercel AI Gateway のキー（vck_…）を使います。CORS が開いているためブラウザから直接呼べます。',
  'typesafe-direct':
    'api.typesafe.ai は CORS オリジンが許可制です。TypeSafe のコンソールでこのページのオリジンを許可していない場合、ブラウザからの呼び出しは preflight で失敗します。',
}

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel)
  if (!el) throw new Error(`要素が見つかりません: ${sel}`)
  return el
}

const el = {
  transport: $<HTMLSelectElement>('#transport'),
  transportHint: $<HTMLParagraphElement>('#transport-hint'),
  apiKey: $<HTMLInputElement>('#api-key'),
  remember: $<HTMLInputElement>('#remember'),
  utterance: $<HTMLTextAreaElement>('#utterance'),
  interim: $<HTMLParagraphElement>('#interim'),
  mic: $<HTMLButtonElement>('#mic'),
  examples: $<HTMLDivElement>('#examples'),
  run: $<HTMLButtonElement>('#run'),
  reset: $<HTMLButtonElement>('#reset'),
  autoRun: $<HTMLInputElement>('#auto-run'),
  status: $<HTMLParagraphElement>('#status'),
  metrics: $<HTMLElement>('#metrics'),
  latency: $<HTMLElement>('#m-latency'),
  tokens: $<HTMLElement>('#m-tokens'),
  cost: $<HTMLElement>('#m-cost'),
  verdicts: $<HTMLDivElement>('#verdicts'),
}

let catalog: LayerCatalog
let styler: LayerStyler
let mapInstance: Awaited<ReturnType<typeof createMap>>['map']
let running: AbortController | null = null
let lastResult: JudgementResult | null = null

function setStatus(message: string, kind: 'info' | 'error' | 'busy' = 'info'): void {
  el.status.textContent = message
  el.status.className = `status${kind === 'info' ? '' : ' ' + kind}`
}

function restoreSettings(): void {
  const settings = loadSettings()
  el.apiKey.value = settings.apiKey
  el.transport.value = settings.transport
  el.remember.checked = settings.remember
  el.transportHint.textContent = TRANSPORT_HINTS[settings.transport]
}

function currentTransport(): JevTransport {
  return el.transport.value === 'typesafe-direct' ? 'typesafe-direct' : 'vercel-gateway'
}

function saveSettings(): void {
  persistSettings({
    apiKey: el.apiKey.value.trim(),
    transport: currentTransport(),
    remember: el.remember.checked,
  })
}

function renderExamples(): void {
  for (const text of EXAMPLES) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.textContent = text
    chip.addEventListener('click', () => {
      el.utterance.value = text
      void run()
    })
    el.examples.append(chip)
  }
}

function renderVerdicts(result: JudgementResult): void {
  el.verdicts.replaceChildren()

  // 強い順に並べると「何が主役になったか」が一目で分かる
  const sorted = [...result.verdicts].sort((a, b) => b.score - a.score)
  for (const verdict of sorted) {
    el.verdicts.append(verdictRow(verdict))
  }

  el.metrics.hidden = false
  el.latency.textContent = `${Math.round(result.latencyMs)} ms`
  const inputTokens = result.usage?.inputTokens
  el.tokens.textContent = inputTokens != null ? inputTokens.toLocaleString() : '—'
  el.cost.textContent =
    inputTokens != null ? `$${(inputTokens * INPUT_USD_PER_TOKEN).toFixed(6)}` : '—'
}

function verdictRow(verdict: GroupVerdict): HTMLElement {
  const row = document.createElement('div')
  row.className = `verdict tier-${verdict.tier}`

  const label = document.createElement('div')
  label.className = 'verdict-label'
  label.textContent = verdict.group.label
  label.title = verdict.group.description

  // 判定を手で上書きできるようにして、Jev の判断と人間の意図のずれを確かめられるようにする
  const select = document.createElement('select')
  for (const tier of ['primary', 'normal', 'muted', 'hidden'] as Tier[]) {
    const option = document.createElement('option')
    option.value = tier
    option.textContent = TIER_LABELS[tier]
    option.selected = tier === verdict.tier
    select.append(option)
  }
  select.addEventListener('change', () => {
    const tier = select.value as Tier
    row.className = `verdict tier-${tier}`
    styler.applyTier(verdict.group, tier)
  })

  const meta = document.createElement('div')
  meta.className = 'verdict-meta'

  const bar = document.createElement('div')
  bar.className = 'bar'
  const fill = document.createElement('i')
  fill.style.width = `${(verdict.score / MAX_LEVEL) * 100}%`
  bar.append(fill)

  const scoreText = document.createElement('span')
  scoreText.textContent = `${verdict.score.toFixed(2)} / ${MAX_LEVEL}`

  const confidence = document.createElement('span')
  const pct = Math.round(verdict.confidence * 100)
  confidence.textContent = `確信 ${pct}%`
  // 確信度が低い判定は人間が見直す価値があるので目立たせる
  if (verdict.confidence < 0.5) confidence.className = 'low-confidence'

  const count = document.createElement('span')
  count.textContent = `${verdict.group.layerIds.length} layers`

  meta.append(bar, scoreText, confidence, count)
  row.append(label, select, meta)
  return row
}

async function run(): Promise<void> {
  const utterance = el.utterance.value.trim()
  const apiKey = el.apiKey.value.trim()

  if (!apiKey) {
    setStatus('API キーを入力してください。', 'error')
    el.apiKey.focus()
    return
  }
  if (!utterance) {
    setStatus('地図への指示を話すか入力してください。', 'error')
    el.utterance.focus()
    return
  }

  running?.abort()
  running = new AbortController()
  el.run.disabled = true
  setStatus('Jev が 23 グループの重要度を判定中…', 'busy')
  saveSettings()

  const client = new JevClient({ apiKey, transport: currentTransport() })
  const groups = judgeableGroups(catalog)

  try {
    const result = await judgeLayers(
      client,
      utterance,
      groups,
      readView(mapInstance),
      running.signal,
    )
    lastResult = result
    styler.apply(result.verdicts)
    renderVerdicts(result)
    setStatus(summarize(result))
  } catch (error) {
    if (running.signal.aborted) return
    const message = error instanceof JevError ? error.message : String(error)
    setStatus(message, 'error')
  } finally {
    el.run.disabled = false
    running = null
  }
}

function summarize(result: JudgementResult): string {
  const counts = new Map<Tier, number>()
  for (const v of result.verdicts) counts.set(v.tier, (counts.get(v.tier) ?? 0) + 1)
  const parts = (['primary', 'normal', 'muted', 'hidden'] as Tier[])
    .filter((t) => counts.has(t))
    .map((t) => `${TIER_LABELS[t]} ${counts.get(t)}`)
  return `「${result.utterance}」→ ${parts.join(' / ')}`
}

function setupVoice(): void {
  if (!isSpeechRecognitionSupported()) {
    el.mic.disabled = true
    el.mic.title = 'このブラウザは音声入力に対応していません'
    el.interim.textContent = '音声入力は Chrome / Edge / Safari でご利用いただけます。'
    return
  }

  const voice = new VoiceInput({
    onInterim: (text) => {
      el.interim.textContent = `聞き取り中: ${text}`
    },
    onFinal: (text) => {
      el.interim.textContent = ''
      el.utterance.value = text
      if (el.autoRun.checked) void run()
    },
    onError: (message) => setStatus(message, 'error'),
    onStateChange: (listening) => {
      el.mic.classList.toggle('listening', listening)
      if (listening) {
        el.interim.textContent = '聞き取り中…'
        setStatus('話しかけてください。', 'busy')
      }
    },
  })

  el.mic.addEventListener('click', () => voice.toggle())
}

async function main(): Promise<void> {
  restoreSettings()
  renderExamples()
  setupVoice()

  el.transport.addEventListener('change', () => {
    el.transportHint.textContent = TRANSPORT_HINTS[currentTransport()]
    saveSettings()
  })
  el.remember.addEventListener('change', saveSettings)
  el.apiKey.addEventListener('change', saveSettings)
  el.run.addEventListener('click', () => void run())
  el.reset.addEventListener('click', () => {
    styler.reset()
    el.verdicts.replaceChildren()
    el.metrics.hidden = true
    lastResult = null
    setStatus('地理院地図の標準スタイルに戻しました。')
  })
  el.utterance.addEventListener('keydown', (e) => {
    // 改行ではなく実行を主操作にする
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void run()
    }
  })

  setStatus('地図とレイヤーカタログを読み込み中…', 'busy')
  try {
    const [bundle, loaded] = await Promise.all([
      createMap($('#map')),
      loadCatalog(`${import.meta.env.BASE_URL}data/gsi-layer-catalog.json`),
    ])
    mapInstance = bundle.map
    styler = new LayerStyler(bundle.map, bundle.baseStyle)
    catalog = loaded
    setStatus(
      `${catalog.totalLayers} レイヤーを ${judgeableGroups(catalog).length} グループに集約しました。` +
        'API キーを入力し、指示を話すか入力してください。',
    )
  } catch (error) {
    setStatus(`初期化に失敗しました: ${String(error)}`, 'error')
  }
}

void main()

// 開発時に判定結果を手元で確認できるようにしておく
Object.defineProperty(window, 'jevLastResult', { get: () => lastResult })
Object.assign(window, { jevToTier: toTier })
