import React, { useEffect, useRef, useState } from 'react'
import { View, TextInput as TextInputNative } from 'react-native'
import { Button, TextInput } from 'react-native-paper'


const EmailPasswordForm = ({
  initialEmail,
  submitText,
  onSubmit,
  onChange,
} : {
  initialEmail?: string,
  submitText: string,
  onSubmit: (email: string, password: string) => Promise<void>
  onChange?: (email: string, password: string) => void
}) => {
  const emailInput = useRef<TextInputNative>(null)
  const passwordInput = useRef<TextInputNative>(null)
  const [email, setEmail] = useState(initialEmail ?? '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    onChange?.(email, password)
  }, [email, password])

  const handleAction = async () => {
    setLoading(true)
    emailInput.current?.blur()
    passwordInput.current?.blur()
    await onSubmit(email, password)
    setLoading(false)
  }

  return (
    <View>
      <View style={{ gap: 12 }}>
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
          onSubmitEditing={handleAction}
          secureTextEntry={!showPassword}
          placeholder="At least 6 characters"
          enterKeyHint="done"
          autoComplete="new-password"
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      <View style={{ marginTop: 20 }}>
        <Button mode="contained" disabled={loading} onPress={handleAction}>
          {submitText}
        </Button>
      </View>
    </View>
  )
}

export default EmailPasswordForm