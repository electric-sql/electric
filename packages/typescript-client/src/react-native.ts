import { AppState } from 'react-native'

import { createReactNativeRuntimeVisibilityAdapter } from './client'
import { setDefaultRuntimeVisibilityAdapterFactory } from './runtime-visibility'

setDefaultRuntimeVisibilityAdapterFactory(() =>
  createReactNativeRuntimeVisibilityAdapter(AppState)
)

export * from './index'
