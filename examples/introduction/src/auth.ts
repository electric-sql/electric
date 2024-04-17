import { getCachedSessionId } from './session'

// We use the sessionId as the userId for this demo.
// This allows us to limit the data that syncs onto
// the device to just the data for the session.
export const userId = () => getCachedSessionId()
