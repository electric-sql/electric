import React, { useState } from 'react'
import { Alert, View } from 'react-native'
import { Button } from 'react-native-paper'
import EmailPasswordForm from '../../components/EmailPasswordForm'
import { Link, router, useLocalSearchParams } from 'expo-router'
import { useAuthActions } from '../../components/AuthProvider'

export default function SignUp() {
  const { email: initialEmail } = useLocalSearchParams<{ email: string }>()
  const [ email, setEmail ] = useState<string>('')
  const { signUp } = useAuthActions()
  const signUpWithEmail = async (email: string, password: string) => {
    const { error } = await signUp({
      email: email,
      password: password,
    })
    if (error) Alert.alert(error.message)
    else router.replace('/')
  }

  return (
    <View style={{ gap: 12 }}>
      <EmailPasswordForm
        initialEmail={initialEmail}
        passwordPlaceholder='Must have at least 6 characters'
        submitText="Sign up"
        onSubmit={signUpWithEmail}
        onChange={(email, _) => setEmail(email)}
        />
      <Link href={`/sign_in?email=${encodeURIComponent(email)}`} replace asChild>
        <Button mode="text">
          I already have an account
        </Button>
      </Link>
    </View>
  )
}
