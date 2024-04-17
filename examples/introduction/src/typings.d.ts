declare module '*.module.css'
declare module '*.svg'

declare module 'memorystorage' {
  export default class MemoryStorage {
    constructor()
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
  }
}
