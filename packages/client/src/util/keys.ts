export type Key = string | symbol

export const isPrivateKey = (key: Key): boolean => {
  return typeof key === 'string' && key.startsWith('_')
}

export const isPublicKey = (key: Key): boolean => {
  return !isPrivateKey(key)
}

export const hasPublicKey = (obj: any, key: Key): boolean => {
  return key in obj && isPublicKey(key)
}

export const publicKeys = (obj: any): Key[] => {
  return Reflect.ownKeys(obj).filter(isPublicKey)
}
