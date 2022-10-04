export const lsnDecoder = new TextDecoder()
export const lsnEncoder = new TextEncoder()

// works for both satellite and electric
export const DEFAULT_LSN = lsnEncoder.encode("0")
