// @ts-check
// NOTE: import via `expo/config-plugins` (not `@expo/config-plugins`)
// because pnpm doesn't hoist the latter into agents-mobile's
// node_modules, so `require('@expo/config-plugins')` fails inside
// EAS Build's read-config step. `expo` is a direct dep and re-exports
// the plugin helpers.
const { withMainActivity } = require(`expo/config-plugins`)

/**
 * Expo config plugin: inject an `onNewIntent` override into the
 * generated `MainActivity.kt` so deep links delivered after the
 * Custom Tab dismisses correctly reach `expo-linking` and
 * `expo-web-browser`.
 *
 * Why this exists:
 *
 * On Android 13+ (and especially Android 16) release builds, the OS
 * is aggressive about killing the app process while the user is in a
 * Chrome Custom Tab. When the OAuth redirect bounces back into the
 * app via our custom scheme (`electric-agents://oauth/callback?...`),
 * Android restarts the activity and delivers the redirect as a new
 * intent. The default Expo `MainActivity.kt` (from the bare template)
 * does not override `onNewIntent`, so the runtime's currently-cached
 * `getIntent()` keeps pointing at the original LAUNCHER intent.
 *
 * The visible symptoms:
 *   - `WebBrowser.openAuthSessionAsync()` returns `{type: 'dismiss'}`
 *     instead of `{type: 'success', url: ...}`.
 *   - `Linking.getInitialURL()` returns `null`.
 *   - `Linking.addEventListener('url', ...)` never fires.
 *
 * The fix is to forward the new intent so anything that calls
 * `getIntent()` (including expo-modules-core / expo-linking) sees
 * the redirect URL:
 *
 *   override fun onNewIntent(intent: Intent) {
 *     super.onNewIntent(intent)
 *     setIntent(intent)
 *   }
 *
 * Reference: https://github.com/expo/expo/issues/44284
 */
const withAndroidOnNewIntent = (config) => {
  return withMainActivity(config, (modConfig) => {
    const mainActivity = modConfig.modResults
    if (mainActivity.language !== `kt`) {
      console.warn(
        `[with-android-on-new-intent] Skipping: expected Kotlin MainActivity, got ${mainActivity.language}.`
      )
      return modConfig
    }

    let contents = mainActivity.contents

    // Ensure `android.content.Intent` is imported. The default
    // template doesn't import it, since none of the standard
    // overrides reference it.
    if (!/^import\s+android\.content\.Intent\s*$/m.test(contents)) {
      contents = contents.replace(
        /(^package\s+[^\n]+\n)/m,
        `$1\nimport android.content.Intent\n`
      )
    }

    // Add the override if it isn't already present. We match both the
    // nullable (`Intent?`) and non-nullable (`Intent`) signatures so
    // re-running prebuild on a project that has been patched by hand
    // doesn't double-inject the method.
    const alreadyOverridden =
      /override\s+fun\s+onNewIntent\s*\(\s*intent\s*:\s*Intent\??\s*\)/.test(
        contents
      )
    if (!alreadyOverridden) {
      const override = [
        ``,
        `  /**`,
        `   * Forward new intents (e.g. deep links delivered after Chrome`,
        `   * Custom Tab dismisses) so expo-linking / expo-web-browser`,
        `   * pick them up via getIntent(). Injected by`,
        `   * plugins/with-android-on-new-intent.js — see that file for`,
        `   * the underlying Expo issue this works around.`,
        `   */`,
        `  override fun onNewIntent(intent: Intent) {`,
        `    super.onNewIntent(intent)`,
        `    setIntent(intent)`,
        `  }`,
        ``,
      ].join(`\n`)

      contents = contents.replace(
        /(class\s+MainActivity\s*:\s*ReactActivity\s*\(\s*\)\s*\{)/,
        `$1${override}`
      )
    }

    mainActivity.contents = contents
    return modConfig
  })
}

module.exports = withAndroidOnNewIntent
