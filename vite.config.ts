import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * 実験は experiments/<id>/index.html として増えていく。ここを手で列挙すると
 * 実験追加のたびに設定変更が要るため、ディレクトリ走査で入力を組み立てる。
 */
function experimentInputs(): Record<string, string> {
  const dir = resolve(root, 'experiments')
  if (!existsSync(dir)) return {}
  return Object.fromEntries(
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(resolve(dir, e.name, 'index.html')))
      .map((e) => [e.name, resolve(dir, e.name, 'index.html')]),
  )
}

export default defineConfig({
  // GitHub Pages のサブパス配信を前提にする。リポジトリ名が変わっても
  // Actions 側から VITE_BASE で上書きできるようにしておく。
  base: process.env.VITE_BASE ?? '/jev-map-sandbox/',
  resolve: {
    alias: { '@shared': resolve(root, 'shared') },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        portal: resolve(root, 'index.html'),
        ...experimentInputs(),
      },
    },
  },
})
