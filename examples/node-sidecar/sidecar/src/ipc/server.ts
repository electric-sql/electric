export interface Server {
  /**
   * Starts the IPC server.
   */
  start(): Promise<void>

  /**
   * Stops the IPC server.
   */
  stop(): Promise<void>
  
  /**
   * Registers a callback to be called on potential data changes.
   * @param cb The callback to call when a potential data change message is received.
   */
  onPotentialDataChange(cb: () => void | Promise<void>): void

  /**
   * Notifies clients of actual data changes.
   */
  notifyDataChanged(): Promise<void>
}