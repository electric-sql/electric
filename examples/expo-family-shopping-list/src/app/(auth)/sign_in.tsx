import React, { useState } from 'react'
import { Alert, View } from 'react-native'
import { Button } from 'react-native-paper'
import EmailPasswordForm from '../../components/EmailPasswordForm'
import { Link, router, useLocalSearchParams } from 'expo-router'
import { useAuthActions } from '../../components/AuthProvider'

export default function SignIn() {
  const { email: initialEmail } = useLocalSearchParams<{ email: string }>()
  const [ email, setEmail ] = useState<string>('')
  const { signIn } = useAuthActions()
  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await signIn({
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
        submitText="Sign in"
        onSubmit={signInWithEmail}
        onChange={(email, _) => setEmail(email)}
        />
      <Link href={`/sign_up?email=${encodeURIComponent(email)}`} replace asChild>
        <Button mode="text">
          I don't have an account
        </Button>
      </Link>
    </View>
  )
}
