export interface Client {
  /**
   * Starts the IPC client.
   */
  start(): Promise<void>

  /**
   * Stops the IPC client.
   */
  stop(): Promise<void>

  /**
   * Registers a callback to be called on data changes.
   * @param cb The callback to call when a data change message is received.
   */
  onDataChange(cb: () => void | Promise<void>): void

  /**
   * Notifies the sidecar of potential data changes.
   */
  notifyPotentialDataChange(): Promise<void>
}