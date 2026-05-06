import { watch } from 'node:fs'
import { loadConfig, type McpConfig } from './loader'

export interface WatchOptions {
  debounceMs?: number
}

export function watchConfig(
  path: string,
  onChange: (cfg: McpConfig) => void,
  opts: WatchOptions = {}
): () => void {
  const debounceMs = opts.debounceMs ?? 500
  let timer: NodeJS.Timeout | undefined
  const reload = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      try {
        onChange(await loadConfig(path))
      } catch (err) {
        console.error(`mcp.json reload failed:`, err)
      }
    }, debounceMs)
  }
  reload()
  const watcher = watch(path, () => reload())
  return () => {
    watcher.close()
    if (timer) clearTimeout(timer)
  }
}
