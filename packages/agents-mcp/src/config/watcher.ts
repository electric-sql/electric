import fs from 'node:fs'
import { loadConfig, type McpConfig } from './loader'

export interface WatchOpts {
  onChange: (cfg: McpConfig) => void
  onError?: (err: unknown) => void
  debounceMs?: number
  env?: NodeJS.ProcessEnv
}

export async function watchConfig(
  path: string,
  opts: WatchOpts
): Promise<() => void> {
  const debounce = opts.debounceMs ?? 200
  let timer: NodeJS.Timeout | undefined
  const reload = async () => {
    try {
      const cfg = await loadConfig(path, opts.env)
      opts.onChange(cfg)
    } catch (err) {
      opts.onError?.(err)
    }
  }
  await reload()
  const watcher = fs.watch(path, () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(reload, debounce)
  })
  return () => {
    if (timer) clearTimeout(timer)
    watcher.close()
  }
}
