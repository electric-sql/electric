import { DbNamespace } from '../util/types'

interface defaults {
  namespace: DbNamespace
}

export const DEFAULTS: defaults = {
  namespace: 'main'
}
