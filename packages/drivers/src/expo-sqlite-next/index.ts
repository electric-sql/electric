// N.b.: importing this module is an entrypoint that imports the React Native
// environment dependencies. Specifically `react-native-fs`. You can use the
// alternative entrypoint in `./test` to avoid importing this.
export { DatabaseAdapter } from './adapter'
export type { Database } from './database'
export { MockDatabase } from './mock.js'
