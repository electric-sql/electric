import React from 'react'
import { Alert, View, AppState, SafeAreaView } from 'react-native'
import { Button } from 'react-native-paper'
import { supabase } from '../lib/auth'
import EmailPasswordForm from '../components/EmailPasswordForm'
import { Link } from 'expo-router'

// Tells Supabase Auth to continuously refresh the session automatically if
// the app is in the foreground. When this is added, you will continue to receive
// `onAuthStateChange` events with the `TOKEN_REFRESHED` or `SIGNED_OUT` event
// if the user's session is terminated. This should only be registered once.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh()
  } else {
    supabase.auth.stopAutoRefresh()
  }
})

export default function SignIn() {
  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    })
    if (error) Alert.alert(error.message)
  }
  return (
    <SafeAreaView style={{ marginHorizontal: 16 }}>
      <EmailPasswordForm
        submitText="Sign in"
        onSubmit={signInWithEmail}
        />
      <Link href="/sign_up" asChild>
        <Button mode="text" style={{ marginTop: 12 }}>
          I don't have an account
        </Button>
      </Link>
    </SafeAreaView>
  )
}
