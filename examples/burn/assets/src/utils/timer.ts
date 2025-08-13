export class SharedTimer {
  private subscribers = new Set<() => void>()
  private timeoutId: number | null = null

  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback)

    if (this.subscribers.size === 1) {
      this.start()
    }

    return () => {
      this.subscribers.delete(callback)

      if (this.subscribers.size === 0) {
        this.stop()
      }
    }
  }

  private start(): void {
    this.stop() // Clear any existing timers
    this.scheduleNext()
  }

  private scheduleNext(): void {
    const now = new Date()
    const msUntilNextMinute =
      (60 - now.getSeconds()) * 1000 - now.getMilliseconds()

    this.timeoutId = window.setTimeout(() => {
      this.notifySubscribers()
      this.scheduleNext()
    }, msUntilNextMinute)
  }

  private notifySubscribers(): void {
    this.subscribers.forEach((callback) => callback())
  }

  private stop(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId)

      this.timeoutId = null
    }
  }
}
