import { ElectricNamespace } from '../electric/namespace'

// Common interface provided by electric proxy wrappers.
export interface ProxyWrapper {
  electric: ElectricNamespace

  _setOriginal(original: any): void
  _getOriginal(): any
}
