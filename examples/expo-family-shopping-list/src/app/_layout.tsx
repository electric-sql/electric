import { Slot, router } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import AuthProvider from '../components/AuthProvider';
import { Href } from 'expo-router/build/link/href';

// NOTE(msfstef): expo-router does not provide any convenient APIs
// for this as far as I can tell
// see: https://github.com/expo/router/discussions/495
function clearHistory(newPath: Href) {
  
  // Pop from stack until one element is left
  while (router.canGoBack()) { 
    router.back();
  }

  // Replace the last remaining element with provided path
  router.replace(newPath); 
}

export default function RootLayout() {
  return (
    <PaperProvider>
      <AuthProvider onSignOut={() => clearHistory('/sign_in')}>
        <Slot />
      </AuthProvider>
    </PaperProvider>
  )
}