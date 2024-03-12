const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

config = {
  resolver: {
    unstable_enablePackageExports: true,
    // default condition names 'import' and 'require' can
    // accidentally require module that assume node
    // libraries and APIs are present - specify expo/react-native
    // for info, see: https://metrobundler.dev/docs/package-exports/
    unstable_conditionNames: ['op-sqlite', 'react-native'],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
