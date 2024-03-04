const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

config.resolver = {
  ...config.resolver,
  unstable_enablePackageExports: true,
  // default condition names 'import' and 'require' can
  // accidentally require module that assume node
  // libraries and APIs are present - specify expo/react-native
  // for info, see: https://metrobundler.dev/docs/package-exports/
  unstable_conditionNames: ['expo', 'react-native'],
}

module.exports = config
