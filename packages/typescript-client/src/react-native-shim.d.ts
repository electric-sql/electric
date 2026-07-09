// Minimal declaration used only to type-check the conditional React Native
// entrypoint without adding react-native as a dependency of the client package.
declare module 'react-native' {
  export const AppState: {
    currentState: 'active' | 'background' | 'inactive' | null
    addEventListener: (
      type: 'change',
      listener: (state: 'active' | 'background' | 'inactive' | null) => void
    ) => { remove: () => void }
  }
}
