// Minimal ambient types for `expo/dom`. The `'use dom'` embed files in this
// directory are bundled by the mobile app (which depends on expo and provides
// the real `expo/dom` at runtime); they are never imported by agents-server-ui's
// own web/electron build. agents-server-ui itself does not depend on expo, so we
// shim the tiny surface we use to keep `tsc` happy here. The mobile app
// typechecks these same files against the real `expo/dom`.
declare module 'expo/dom' {
  export interface DOMImperativeFactory {
    [key: string]: (...args: Array<unknown>) => void
  }
  export function useDOMImperativeHandle<T extends DOMImperativeFactory>(
    ref: unknown,
    init: () => T,
    deps?: ReadonlyArray<unknown>
  ): void
}
