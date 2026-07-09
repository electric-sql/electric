import type { RuntimeVisibilityAdapter } from './client'

type RuntimeVisibilityAdapterFactory = () =>
  | RuntimeVisibilityAdapter
  | undefined

let defaultRuntimeVisibilityAdapterFactory:
  | RuntimeVisibilityAdapterFactory
  | undefined

export function setDefaultRuntimeVisibilityAdapterFactory(
  factory: RuntimeVisibilityAdapterFactory | undefined
): void {
  defaultRuntimeVisibilityAdapterFactory = factory
}

export function getDefaultRuntimeVisibilityAdapterFactory():
  | RuntimeVisibilityAdapterFactory
  | undefined {
  return defaultRuntimeVisibilityAdapterFactory
}
