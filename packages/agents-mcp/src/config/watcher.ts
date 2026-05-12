import fs from 'node:fs'
import pathModule from 'node:path'
import { loadConfig, type McpConfig } from './loader'

export interface WatchOpts {
  onChange: (cfg: McpConfig) => void
  onError?: (err: unknown) => void
  debounceMs?: number
  env?: NodeJS.ProcessEnv
}

/**
 * Start watching `path` for changes. Each modification triggers
 * `loadConfig(path)` (debounced) and forwards the parsed config to
 * `onChange`, or any error to `onError`. The caller is responsible
 * for performing the initial load — `watchConfig` only sets up the
 * subscription so the caller can fully await its first apply before
 * subsequent change events start firing.
 */
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
  const watchPath = pathModule.resolve(path)
  const watchParentPath = pathModule.dirname(watchPath)
  const watchFileName = pathModule.basename(watchPath)
  let watcher: fs.FSWatcher
  const onFileChanged = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(reload, debounce)
  }

  try {
    watcher = fs.watch(watchPath, onFileChanged)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== `ENOENT`) throw err
    watcher = fs.watch(watchParentPath, (_event, filename) => {
      if (filename === null || filename.toString() === watchFileName) {
        onFileChanged()
      }
    })
  }

  return () => {
    if (timer) clearTimeout(timer)
    watcher.close()
  }
}
