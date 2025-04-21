import { ResumeState, ResumeStateProvider } from "./types"

/**
 * Implementation of ResumeStateProvider using localStorage
 */
export class LocalStorageResumeStateProvider implements ResumeStateProvider {
  private key: string

  /**
   * Creates a new LocalStorageResumeStateProvider
   * @param key The localStorage key to use for storing the resume state
   */
  constructor(key: string = `electric_resume_state`) {
    this.key = key
  }

  /**
   * Save the resume state to localStorage
   * @param state The resume state to save
   */
  save(state: ResumeState): void {
    try {
      const dataToStore = {
        ...state,
        batching: state.batching ? Array.from(state.batching) : undefined,
        sending: state.sending ? Array.from(state.sending) : undefined,
      }
      // We need to convert the Uint8Array to a regular array for storage
      localStorage.setItem(this.key, JSON.stringify(dataToStore))
      // TODO: check that we're not logging to much
      // console.log(`Resume state saved to localStorage`, dataToStore)
    } catch (error) {
      console.error(`Failed to save resume state to localStorage`, error)
    }
  }

  /**
   * Load the resume state from localStorage
   * @returns The resume state or undefined if none exists
   */
  load(): ResumeState | undefined {
    try {
      const storedData = localStorage.getItem(this.key)
      if (!storedData) {
        return undefined
      }

      const parsedData = JSON.parse(storedData)

      // Convert the array back to Uint8Array if it exists
      if (parsedData.batching) {
        parsedData.batching = new Uint8Array(parsedData.batching)
      }

      if (parsedData.sending) {
        parsedData.sending = new Uint8Array(parsedData.sending)
      }

      return parsedData
    } catch (error) {
      console.error(`Failed to load resume state from localStorage`, error)
      return undefined
    }
  }
}
