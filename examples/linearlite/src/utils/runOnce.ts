const RUN_ONCE_KEY_BASE = '__electric_run_once:'

function runOnce<T>(key: string, fn: () => void): T | void {
  if (!localStorage.getItem(RUN_ONCE_KEY_BASE + key)) {
    const result = fn()
    localStorage.setItem(RUN_ONCE_KEY_BASE + key, '1')
    return result
  }
}

function clearRuns() {
  const numKeys = localStorage.length
  for (let i = 0; i < numKeys; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(RUN_ONCE_KEY_BASE)) {
      localStorage.removeItem(key)
    }
  }
}

export { runOnce, clearRuns }
