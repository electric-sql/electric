import { version } from '../../../package.json'
import { LIB_VERSION } from '../../version'

export const LIB_MINOR_VERSION = LIB_VERSION.split('.').slice(0, 2).join('.')

// the LIB_VERSION export does not update for canary releases
// so using the package.json explicitly for this check
export const LIB_IS_CANARY_RELEASE = version.includes('canary')
