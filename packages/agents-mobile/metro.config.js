const path = require(`node:path`)
// Drop-in for `getDefaultConfig` that injects Sentry Debug IDs for source maps.
const { getSentryExpoConfig } = require(`@sentry/react-native/metro`)

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, `../..`)
const serverUiRoot = path.resolve(workspaceRoot, `packages/agents-server-ui`)

const config = getSentryExpoConfig(projectRoot)
const defaultResolveRequest = config.resolver.resolveRequest

const forcedAliases = {
  '@electric-ax/agents-runtime/client': path.resolve(
    workspaceRoot,
    `packages/agents-runtime/src/client.ts`
  ),
  mermaid: path.resolve(serverUiRoot, `src/embed/stubs/mermaid.ts`),
  katex: path.resolve(serverUiRoot, `src/embed/stubs/katex.ts`),
  '@streamdown/math': path.resolve(
    serverUiRoot,
    `src/embed/stubs/streamdown-math.ts`
  ),
  'shiki/bundle/web': path.resolve(serverUiRoot, `src/embed/stubs/shiki.ts`),
}

function resolveFromMobile(moduleName) {
  return require.resolve(moduleName, { paths: [projectRoot] })
}

function resolveForcedModule(moduleName) {
  if (
    moduleName === `react` ||
    moduleName.startsWith(`react/`) ||
    moduleName === `react-dom` ||
    moduleName.startsWith(`react-dom/`) ||
    moduleName === `react-native-web` ||
    moduleName.startsWith(`react-native-web/`)
  ) {
    return resolveFromMobile(moduleName)
  }

  return forcedAliases[moduleName]
}

config.watchFolders = Array.from(
  new Set([...(config.watchFolders ?? []), workspaceRoot])
)

config.resolver = {
  ...config.resolver,
  resolveRequest(context, moduleName, platform) {
    const forced = resolveForcedModule(moduleName)
    if (forced) {
      return { type: `sourceFile`, filePath: forced }
    }

    if (defaultResolveRequest) {
      return defaultResolveRequest(context, moduleName, platform)
    }
    return context.resolveRequest(context, moduleName, platform)
  },
  extraNodeModules: {
    ...(config.resolver.extraNodeModules ?? {}),
    react: path.resolve(projectRoot, `node_modules/react`),
    'react-dom': path.resolve(projectRoot, `node_modules/react-dom`),
    'react-native-web': path.resolve(
      projectRoot,
      `node_modules/react-native-web`
    ),
    ...forcedAliases,
  },
}

module.exports = config
