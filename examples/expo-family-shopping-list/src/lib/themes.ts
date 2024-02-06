import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper'
import {
  DarkTheme as OriginalDarkNavigationTheme,
  DefaultTheme as OriginalLightNavigationTheme
} from '@react-navigation/native'
import { adaptNavigationTheme } from 'react-native-paper'


const CustomLightTheme = {
  ...MD3LightTheme,
  "colors": {
    "primary": "rgb(0, 108, 81)",
    "onPrimary": "rgb(255, 255, 255)",
    "primaryContainer": "rgb(87, 253, 200)",
    "onPrimaryContainer": "rgb(0, 33, 22)",
    "secondary": "rgb(33, 95, 166)",
    "onSecondary": "rgb(255, 255, 255)",
    "secondaryContainer": "rgb(213, 227, 255)",
    "onSecondaryContainer": "rgb(0, 28, 59)",
    "tertiary": "rgb(88, 82, 178)",
    "onTertiary": "rgb(255, 255, 255)",
    "tertiaryContainer": "rgb(227, 223, 255)",
    "onTertiaryContainer": "rgb(19, 0, 104)",
    "error": "rgb(186, 26, 26)",
    "onError": "rgb(255, 255, 255)",
    "errorContainer": "rgb(255, 218, 214)",
    "onErrorContainer": "rgb(65, 0, 2)",
    "background": "rgb(251, 253, 249)",
    "onBackground": "rgb(25, 28, 26)",
    "surface": "rgb(251, 253, 249)",
    "onSurface": "rgb(25, 28, 26)",
    "surfaceVariant": "rgb(219, 229, 222)",
    "onSurfaceVariant": "rgb(64, 73, 68)",
    "outline": "rgb(112, 121, 116)",
    "outlineVariant": "rgb(191, 201, 194)",
    "shadow": "rgb(0, 0, 0)",
    "scrim": "rgb(0, 0, 0)",
    "inverseSurface": "rgb(46, 49, 47)",
    "inverseOnSurface": "rgb(239, 241, 238)",
    "inversePrimary": "rgb(44, 224, 173)",
    "elevation": {
      "level0": "transparent",
      "level1": "rgb(238, 246, 241)",
      "level2": "rgb(231, 241, 236)",
      "level3": "rgb(223, 237, 231)",
      "level4": "rgb(221, 236, 229)",
      "level5": "rgb(216, 233, 226)"
    },
    "surfaceDisabled": "rgba(25, 28, 26, 0.12)",
    "onSurfaceDisabled": "rgba(25, 28, 26, 0.38)",
    "backdrop": "rgba(41, 50, 46, 0.4)"
  }
}

const CustomDarkTheme = {
  ...MD3DarkTheme,
  "colors": {
    "primary": "rgb(44, 224, 173)",
    "onPrimary": "rgb(0, 56, 40)",
    "primaryContainer": "rgb(0, 81, 60)",
    "onPrimaryContainer": "rgb(87, 253, 200)",
    "secondary": "rgb(166, 200, 255)",
    "onSecondary": "rgb(0, 48, 96)",
    "secondaryContainer": "rgb(0, 71, 135)",
    "onSecondaryContainer": "rgb(213, 227, 255)",
    "tertiary": "rgb(196, 192, 255)",
    "onTertiary": "rgb(41, 30, 129)",
    "tertiaryContainer": "rgb(64, 56, 152)",
    "onTertiaryContainer": "rgb(227, 223, 255)",
    "error": "rgb(255, 180, 171)",
    "onError": "rgb(105, 0, 5)",
    "errorContainer": "rgb(147, 0, 10)",
    "onErrorContainer": "rgb(255, 180, 171)",
    "background": "rgb(25, 28, 26)",
    "onBackground": "rgb(225, 227, 224)",
    "surface": "rgb(25, 28, 26)",
    "onSurface": "rgb(225, 227, 224)",
    "surfaceVariant": "rgb(64, 73, 68)",
    "onSurfaceVariant": "rgb(191, 201, 194)",
    "outline": "rgb(137, 147, 141)",
    "outlineVariant": "rgb(64, 73, 68)",
    "shadow": "rgb(0, 0, 0)",
    "scrim": "rgb(0, 0, 0)",
    "inverseSurface": "rgb(225, 227, 224)",
    "inverseOnSurface": "rgb(46, 49, 47)",
    "inversePrimary": "rgb(0, 108, 81)",
    "elevation": {
      "level0": "transparent",
      "level1": "rgb(26, 38, 33)",
      "level2": "rgb(27, 44, 38)",
      "level3": "rgb(27, 50, 42)",
      "level4": "rgb(27, 52, 44)",
      "level5": "rgb(28, 55, 47)"
    },
    "surfaceDisabled": "rgba(225, 227, 224, 0.12)",
    "onSurfaceDisabled": "rgba(225, 227, 224, 0.38)",
    "backdrop": "rgba(41, 50, 46, 0.4)"
  }
}


const {
  LightTheme: CustomLightNavigationTheme,
  DarkTheme: CustomDarkNavigationTheme
} = adaptNavigationTheme({
  reactNavigationLight: OriginalLightNavigationTheme,
  materialLight: CustomLightTheme,
  reactNavigationDark: OriginalDarkNavigationTheme,
  materialDark: CustomDarkTheme,
});

export {
  CustomLightTheme,
  CustomDarkTheme,
  CustomLightNavigationTheme,
  CustomDarkNavigationTheme
}