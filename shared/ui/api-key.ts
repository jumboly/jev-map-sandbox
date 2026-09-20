import type { JevTransport } from '@shared/jev'

const KEY_STORAGE = 'jev-map-sandbox:api-key'
const TRANSPORT_STORAGE = 'jev-map-sandbox:transport'

export interface ApiKeySettings {
  apiKey: string
  transport: JevTransport
  remember: boolean
}

/** localStorage は Private Window などで例外を投げうるので必ず握りつぶす。 */
const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* 保存できなくても動作は継続する */
    }
  },
  del(k: string): void {
    try {
      localStorage.removeItem(k)
    } catch {
      /* noop */
    }
  },
}

export function loadSettings(): ApiKeySettings {
  const apiKey = store.get(KEY_STORAGE) ?? ''
  const transport = store.get(TRANSPORT_STORAGE)
  return {
    apiKey,
    transport: transport === 'typesafe-direct' ? 'typesafe-direct' : 'vercel-gateway',
    // 保存済みキーが存在することが「記憶する」が選ばれていた証拠
    remember: apiKey !== '',
  }
}

export function persistSettings(settings: ApiKeySettings): void {
  store.set(TRANSPORT_STORAGE, settings.transport)
  if (settings.remember && settings.apiKey) {
    store.set(KEY_STORAGE, settings.apiKey)
  } else {
    store.del(KEY_STORAGE)
  }
}
