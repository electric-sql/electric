export interface McpTransportHandle {
  connect(): Promise<void>
  send(message: unknown): Promise<unknown>
  close(): Promise<void>
}
