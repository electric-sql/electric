/**
 * Babel config for the Expo SDK 54 mobile app.
 *
 * SDK 54 ships with React Native 0.81 whose source still uses Flow
 * type annotations (e.g. `{+[name: string]: true}`). Without an
 * explicit `babel-preset-expo` (which composes the React Native
 * preset, including the Flow stripper), Metro's transformer fails on
 * those files with "'identifier' expected in type parameter".
 */
module.exports = function babelConfig(api) {
  api.cache(true)
  return {
    presets: [`babel-preset-expo`],
  }
}
