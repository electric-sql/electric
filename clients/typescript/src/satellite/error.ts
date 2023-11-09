import { SatelliteError, SatelliteErrorCode } from '../util/index.js'
import Log from 'loglevel'

const fatalErrorDescription =
  "Client can't connect with the server after a fatal error. This can happen due to divergence between local client and server. Use developer tools to clear the local database, or delete the database file. We're working on tools to allow recovering the state of the local database."

const throwErrors = [
  SatelliteErrorCode.INTERNAL,
  SatelliteErrorCode.FATAL_ERROR,
]

const fatalErrors = [
  SatelliteErrorCode.INVALID_REQUEST,
  SatelliteErrorCode.UNKNOWN_SCHEMA_VSN,
  SatelliteErrorCode.AUTH_REQUIRED,
]

const outOfSyncErrors = [
  SatelliteErrorCode.INVALID_POSITION,
  SatelliteErrorCode.BEHIND_WINDOW,
  SatelliteErrorCode.SUBSCRIPTION_NOT_FOUND,
]

export function isThrowable(error: SatelliteError) {
  return throwErrors.includes(error.code)
}

export function isFatal(error: SatelliteError) {
  return fatalErrors.includes(error.code)
}

export function isOutOfSyncError(error: SatelliteError) {
  return outOfSyncErrors.includes(error.code)
}

function logFatalErrorDescription() {
  Log.error(fatalErrorDescription)
}

export function wrapFatalError(error: SatelliteError) {
  logFatalErrorDescription()
  return new SatelliteError(
    SatelliteErrorCode.FATAL_ERROR,
    `Fatal error: ${error.message}. Check log for more information`
  )
}
