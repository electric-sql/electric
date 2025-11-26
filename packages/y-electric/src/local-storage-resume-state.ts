import { ResumeState, ElectricResumeStateProvider } from './types'
import { ObservableV2 } from 'lib0/observable.js'
import { ElectricProvider } from './y-electric'
import * as buffer from 'lib0/buffer'

/**
 * A ResumeStateProvider implementation using LocalStorage.
 * This is a reference implementation that can be used as a starting point
 * for implementing other ResumeStateProviders.
 */
export class LocalStorageResumeStateProvider extends ObservableV2<ElectricResumeStateProvider> {
  private key: string
  private resumeState?: ResumeState

  constructor(key: string) {
    super()
    this.key = key
  }

  subscribeToResumeState(provider: ElectricProvider): () => void {
    const resumeStateHandler = provider.on(`resumeState`, this.save.bind(this))
    return () => provider.off(`resumeState`, resumeStateHandler)
  }

  save(resumeState: ResumeState) {
    const jsonPart = JSON.stringify({
      operations: resumeState.document,
    })
    localStorage.setItem(this.key, jsonPart)

    if (resumeState.stableStateVector) {
      const vectorBase64 = buffer.toBase64(resumeState.stableStateVector)
      localStorage.setItem(`${this.key}_vector`, vectorBase64)
    } else {
      // ensure vector is removed
      localStorage.removeItem(`${this.key}_vector`)
    }
  }

  load(): ResumeState {
    if (this.resumeState) {
      return this.resumeState
    }

    const jsonData = localStorage.getItem(this.key)
    if (!jsonData) {
      this.emit(`synced`, [{}])
    } else {
      this.resumeState = JSON.parse(jsonData)

      const vectorData = localStorage.getItem(`${this.key}_vector`)
      if (vectorData) {
        this.resumeState!.stableStateVector = buffer.fromBase64(vectorData)
      }

      this.emit(`synced`, [this.resumeState!])
    }

    return this.resumeState!
  }
}
