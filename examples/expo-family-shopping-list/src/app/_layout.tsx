import { Stack } from 'expo-router';
import { ThemeProvider } from '@react-navigation/native'
import {
  CustomLightTheme, CustomDarkTheme,
  CustomDarkNavigationTheme, CustomLightNavigationTheme
} from '../lib/themes'
import { PaperProvider } from 'react-native-paper'
import AuthProvider from '../components/AuthProvider';
import { useColorScheme } from 'react-native';


export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === 'dark';  
  const theme = isDarkMode ? CustomDarkTheme : CustomLightTheme
  const navigationTheme = isDarkMode ? CustomDarkNavigationTheme : CustomLightNavigationTheme
  return (
    <PaperProvider theme={theme}>
      <ThemeProvider value={navigationTheme}>
        <AuthProvider>
            <Stack screenOptions={{
              headerShown: false,
              animation: 'none'
              }} />
        </AuthProvider>
      </ThemeProvider>
    </PaperProvider>
  )
}