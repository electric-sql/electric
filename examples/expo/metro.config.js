const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

config.resolver = {
  ...config.resolver,
  unstable_enablePackageExports: true,
  // default conditions for 'import' and 'require' can
  // accidentally require module that assume node
  // libraries and APIs are present - leave empty
  unstable_conditionNames: [],
}

module.exports = config
