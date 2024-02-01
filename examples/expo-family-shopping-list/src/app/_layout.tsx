import { Slot } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import AuthProvider from '../components/AuthProvider';

export default function RootLayout() {
  return (
    <PaperProvider>
      <AuthProvider>
        <Slot />
      </AuthProvider>
    </PaperProvider>
  )
}