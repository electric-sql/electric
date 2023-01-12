import path from 'path-browserify'

import { Path } from './types'

const getURL = async () => {
  if (typeof window !== 'undefined' && window.URL !== undefined) {
    return window.URL
  }

  const mod = await import('url')
  return mod.URL
}

export const URL = await getURL()

export const relativePath = (a: Path, b: Path) => {
  return path.join(path.dirname(a), b)
}

export const relativeImportPath = (path: Path, importMetaUrl: Path) => {
  return new URL(path, importMetaUrl).pathname
}
