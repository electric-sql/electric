import 'react-native-url-polyfill/auto'
import 'fastestsmallesttextencoderdecoder'
import * as Crypto from 'expo-crypto'
import { decode, encode } from 'base-64'

declare const global: {
  crypto: {
    getRandomValues(array: Uint8Array): Uint8Array
    randomUUID(): string
  }
  btoa: (input: string) => string
  atob: (input: string) => string
}

if (!global.btoa) {
  global.btoa = encode
}

if (!global.atob) {
  global.atob = decode
}

if (!global.crypto) {
  global.crypto = {
    getRandomValues(array: Uint8Array) {
      return Crypto.getRandomValues(array)
    },
    randomUUID() {
      return Crypto.randomUUID()
    },
  }
}
