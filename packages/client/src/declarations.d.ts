declare module 'text-encoder-lite' {
  class TextEncoderLite {
    constructor(encoding?: 'utf-8')
    encode(str: string): Uint8Array
  }
  class TextDecoderLite {
    constructor(encoding?: 'utf-8')
    decode(str: Uint8Array): string
  }
}
