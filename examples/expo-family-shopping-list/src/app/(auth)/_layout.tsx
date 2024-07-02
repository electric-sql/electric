import { Redirect, Slot } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppLogo from '../../components/AppLogo';
import { useAuthenticationState } from '../../components/AuthProvider';

export default function AuthLayout() {
  const { authenticated } = useAuthenticationState();
  if (authenticated) return <Redirect href="/" />;
  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <View style={{ alignItems: 'center', marginVertical: 16 }}>
        <AppLogo height={200} width={200} />
      </View>
      <Slot />
    </SafeAreaView>
  );
}
