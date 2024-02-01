import React, { useRef, useState } from 'react'
import { Alert, StyleSheet, View, AppState, TextInput as TextInputNative } from 'react-native'
import { supabase } from '../lib/auth'
import { Button, Text, TextInput } from 'react-native-paper'

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
  const emailInput = useRef<TextInputNative>(null)
  const passwordInput = useRef<TextInputNative>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  const signInWithEmail = async () => {
    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    })
    console.log(data, error)

    if (error) Alert.alert(error.message)
    setLoading(false)
  }

  const signUpWithEmail = async () => {
    setLoading(true)
    const {
      data: { session },
      error,
    } = await supabase.auth.signUp({
      email: email,
      password: password,
    })
    console.log(session, error)

    if (error) Alert.alert(error.message)
    else if (!session) Alert.alert('Please check your inbox for email verification!')
    setLoading(false)
  }

  return (
    <View style={styles.container}>
      <View style={[styles.verticallySpaced, styles.mt20]}>
        <TextInput
          label="Email"
          mode="outlined"
          ref={emailInput}
          left={<TextInput.Icon icon="email" />}
          onChangeText={setEmail}
          value={email}
          onSubmitEditing={() => passwordInput.current?.focus()}
          placeholder="email@address.com"
          autoFocus
          selectTextOnFocus
          enterKeyHint="next"
          autoComplete="email"
          keyboardType="email-address"
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      <View style={styles.verticallySpaced}>
        <TextInput
          label="Password"
          mode="outlined"
          ref={passwordInput}
          left={<TextInput.Icon icon="lock" />}
          right={
            <TextInput.Icon
              icon={showPassword ? 'eye-off' : 'eye'}
              onPress={() => setShowPassword((f) => !f)}
            />
          }
          onChangeText={setPassword}
          value={password}
          onSubmitEditing={signInWithEmail}
          secureTextEntry={!showPassword}
          placeholder="At least 6 characters"
          enterKeyHint="done"
          autoComplete="new-password"
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      <View style={[styles.verticallySpaced, styles.mt20]}>
        <Button mode="contained" disabled={loading} onPress={signInWithEmail}>
          <Text>Sign in</Text>
        </Button>
      </View>
      <View style={styles.verticallySpaced}>
        <Button mode="contained" disabled={loading} onPress={signUpWithEmail}>
          <Text>Sign up</Text>
        </Button>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginTop: 40,
    padding: 12,
  },
  verticallySpaced: {
    paddingTop: 4,
    paddingBottom: 4,
    alignSelf: 'stretch',
  },
  mt20: {
    marginTop: 20,
  },
})