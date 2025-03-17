// TODO: Auto-generated Simple mutex implementation to avoid external dependency
export class Mutex {
  private _locked: boolean = false
  private _queue: Array<() => void> = []

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (!this._locked) {
        this._locked = true
        resolve()
      } else {
        this._queue.push(() => {
          this._locked = true
          resolve()
        })
      }
    })
  }

  release(): void {
    if (this._queue.length > 0) {
      const next = this._queue.shift()
      if (next) next()
    } else {
      this._locked = false
    }
  }
}
