import 'fastestsmallesttextencoderdecoder'

export const decoder = new TextDecoder()
export const encoder = new TextEncoder()

// works for both satellite and electric
export const DEFAULT_LSN = encoder.encode("0")
