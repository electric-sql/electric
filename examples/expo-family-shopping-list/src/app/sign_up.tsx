import React from 'react'
import { Alert, SafeAreaView } from 'react-native'
import { Button } from 'react-native-paper'
import EmailPasswordForm from '../components/EmailPasswordForm'
import { Link } from 'expo-router'
import { signUp } from '../components/AuthProvider'

export default function SignUp() {
  const signUpWithEmail = async (email: string, password: string) => {
    const { error } = await signUp({
      email: email,
      password: password,
    })
    if (error) Alert.alert(error.message)
  }

  return (
    <SafeAreaView style={{ marginHorizontal: 16 }}>
      <EmailPasswordForm
        submitText="Sign up"
        onSubmit={signUpWithEmail}
        />
      <Link href="/sign_in" replace asChild>
        <Button mode="text" style={{ marginTop: 12 }}>
          I already have an account
        </Button>
      </Link>
    </SafeAreaView>
  )
}
