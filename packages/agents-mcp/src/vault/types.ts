export interface KeyVault {
  get(ref: string): Promise<string | null>
  set(ref: string, secret: string, opts?: { expiresAt?: Date }): Promise<void>
  delete(ref: string): Promise<void>
  list(prefix?: string): Promise<Array<{ ref: string; expiresAt?: Date }>>
}
