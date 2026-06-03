import { demoAvatarColors, type DemoAvatarColor } from '../shared/space'

export const normalizeDisplayName = (value: string): string => value.trim()

export const normalizeSpaceTitle = (value: string): string => value.trim()

export const isDemoAvatarColor = (value: string): value is DemoAvatarColor =>
  demoAvatarColors.some((color) => color === value)

const normalizeIdSuffix = (value: string): string => {
  const suffix = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, `_`)
    .replace(/_+/g, `_`)
    .replace(/^_+|_+$/g, ``)

  return suffix.length > 0 ? suffix : `demo`
}

export const createDemoId = (
  prefix: `wiki` | `actor`,
  source?: string
): string => {
  const suffix = normalizeIdSuffix(source ?? crypto.randomUUID())

  return `${prefix}_${suffix}`
}
