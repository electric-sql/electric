import { Notifier } from '../notifiers/index'

// Common interface provided by electric proxy wrappers.
export interface ProxyWrapper {
  electric: Notifier

  _setOriginal(original: any): void
  _getOriginal(): any
}
