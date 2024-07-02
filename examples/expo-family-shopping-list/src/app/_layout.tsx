import { ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AuthProvider from '../components/AuthProvider';
import {
  CustomLightTheme,
  CustomDarkTheme,
  CustomDarkNavigationTheme,
  CustomLightNavigationTheme,
} from '../lib/themes';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === 'dark';
  const theme = isDarkMode ? CustomDarkTheme : CustomLightTheme;
  const navigationTheme = isDarkMode ? CustomDarkNavigationTheme : CustomLightNavigationTheme;
  return (
    <PaperProvider theme={theme}>
      <ThemeProvider value={navigationTheme}>
        <SafeAreaProvider>
          <AuthProvider>
            <Stack
              screenOptions={{
                headerShown: false,
                animation: 'none',
              }}
            />
          </AuthProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </PaperProvider>
  );
}
