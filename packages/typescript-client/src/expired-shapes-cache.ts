interface ExpiredShapeCacheEntry {
  expired: boolean
  time: number
}

/**
 * LRU cache for tracking expired shapes with automatic cleanup
 */
export class ExpiredShapesCache {
  private data: Record<string, ExpiredShapeCacheEntry> = {}
  private max: number = 250
  private readonly storageKey = `electric_expired_shapes`

  isExpired(shapeUrl: string): boolean {
    return this.data[shapeUrl]?.expired || false
  }

  markExpired(shapeUrl: string): void {
    this.data[shapeUrl] = { expired: true, time: Date.now() }

    const keys = Object.keys(this.data)
    if (keys.length > this.max) {
      const oldest = keys.reduce((min, k) =>
        this.data[k].time < this.data[min].time ? k : min
      )
      delete this.data[oldest]
    }

    this.save()
  }

  private save(): void {
    if (typeof localStorage === `undefined`) return
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.data))
    } catch {
      // Ignore localStorage errors
    }
  }

  private load(): void {
    if (typeof localStorage === `undefined`) return
    try {
      const stored = localStorage.getItem(this.storageKey)
      if (stored) {
        this.data = JSON.parse(stored)
      }
    } catch {
      // Ignore localStorage errors, start fresh
      this.data = {}
    }
  }

  constructor() {
    this.load()
  }
}
