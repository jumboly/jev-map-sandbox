/**
 * Web Speech API (SpeechRecognition) の薄いラッパ。
 *
 * 標準 DOM 型定義に SpeechRecognition が含まれないため、使う範囲だけを
 * ここで宣言している。Chrome / Edge / Safari は webkit プレフィックス付き。
 */

interface SpeechRecognitionAlternativeLike {
  transcript: string
  confidence: number
}
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  item(index: number): SpeechRecognitionAlternativeLike
  [index: number]: SpeechRecognitionAlternativeLike
}
interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number
  readonly results: {
    readonly length: number
    item(index: number): SpeechRecognitionResultLike
    [index: number]: SpeechRecognitionResultLike
  }
}
interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string
  readonly message: string
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const isSpeechRecognitionSupported = (): boolean => getCtor() !== null

export interface VoiceInputHandlers {
  /** 認識途中の暫定テキスト。UI のプレビュー用。 */
  onInterim?: (text: string) => void
  /** 確定テキスト。1 回の発話につき 1 度呼ばれる。 */
  onFinal: (text: string) => void
  onError?: (message: string) => void
  onStateChange?: (listening: boolean) => void
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'マイクの使用が許可されていません。ブラウザの権限設定を確認してください。',
  'service-not-allowed': '音声認識サービスが利用できません。',
  'no-speech': '音声が検出されませんでした。もう一度お試しください。',
  'audio-capture': 'マイクが見つかりません。',
  network: '音声認識サーバーに接続できませんでした。',
  aborted: '',
}

export class VoiceInput {
  private recognition: SpeechRecognitionLike | null = null
  private listening = false

  constructor(
    private readonly handlers: VoiceInputHandlers,
    private readonly lang = 'ja-JP',
  ) {}

  get isListening(): boolean {
    return this.listening
  }

  toggle(): void {
    this.listening ? this.stop() : this.start()
  }

  start(): void {
    if (this.listening) return
    const Ctor = getCtor()
    if (!Ctor) {
      this.handlers.onError?.('このブラウザは音声入力に対応していません。テキスト入力をお使いください。')
      return
    }

    const rec = new Ctor()
    rec.lang = this.lang
    // 1 発話ごとに判定を走らせたいので継続認識はしない
    rec.continuous = false
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onstart = () => this.setListening(true)
    rec.onend = () => {
      this.setListening(false)
      this.recognition = null
    }
    rec.onerror = (e) => {
      const message = ERROR_MESSAGES[e.error] ?? `音声認識エラー: ${e.error}`
      if (message) this.handlers.onError?.(message)
    }
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        if (!result) continue
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) {
          const trimmed = text.trim()
          if (trimmed) this.handlers.onFinal(trimmed)
        } else {
          interim += text
        }
      }
      if (interim) this.handlers.onInterim?.(interim)
    }

    this.recognition = rec
    try {
      rec.start()
    } catch (cause) {
      this.setListening(false)
      this.handlers.onError?.(`音声入力を開始できませんでした: ${String(cause)}`)
    }
  }

  stop(): void {
    this.recognition?.stop()
  }

  private setListening(value: boolean): void {
    if (this.listening === value) return
    this.listening = value
    this.handlers.onStateChange?.(value)
  }
}
