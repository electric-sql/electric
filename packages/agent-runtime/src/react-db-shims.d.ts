declare module 'react' {
  export function useMemo<T>(factory: () => T, deps: Array<unknown>): T
}

declare module '@tanstack/react-db' {
  export function useLiveQuery<T>(
    query: unknown,
    deps?: Array<unknown>
  ): { data?: T }
}
