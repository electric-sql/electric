import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { CLOUD_AUTH_REDIRECT_URI, cloudAuth } from '../../src/lib/cloudAuth'
import { useTokens } from '../../src/lib/ThemeProvider'
import { fontSize, lineHeight, spacing } from '../../src/lib/theme'
import type { Tokens } from '../../src/lib/theme'

const CALLBACK_TIMEOUT_MS = 8000

export default function OAuthCallbackRoute(): React.ReactElement {
  const router = useRouter()
  const params = useLocalSearchParams()
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const completedRef = useRef(false)
  const [message, setMessage] = useState(`Finishing sign-in...`)

  useEffect(() => {
    if (completedRef.current) return
    completedRef.current = true

    let cancelled = false
    let timeout: ReturnType<typeof setTimeout> | null = null

    const finish = () => {
      if (timeout) clearTimeout(timeout)
      if (!cancelled) router.replace(`/`)
    }

    try {
      const callbackUrl = buildCallbackUrl(params)
      if (!callbackUrl) {
        finish()
        return
      }

      timeout = setTimeout(() => {
        console.warn(`[agents-mobile] cloud-auth callback timed out`)
        setMessage(`Taking longer than expected...`)
        finish()
      }, CALLBACK_TIMEOUT_MS)

      void cloudAuth
        .completeCallbackUrl(callbackUrl)
        .catch((err) => {
          console.warn(`[agents-mobile] cloud-auth callback failed:`, err)
        })
        .finally(finish)
    } catch (err) {
      console.warn(`[agents-mobile] cloud-auth callback route failed:`, err)
      finish()
    }

    return () => {
      cancelled = true
      if (timeout) clearTimeout(timeout)
    }
  }, [params, router])

  return (
    <View style={styles.root}>
      <ActivityIndicator color={tokens.accent11} />
      <Text style={styles.text}>{message}</Text>
    </View>
  )
}

function buildCallbackUrl(params: ReturnType<typeof useLocalSearchParams>) {
  const token = getParam(params.token)
  const state = getParam(params.state)
  const email = getParam(params.email)
  const expiresAt = getParam(params.expiresAt)
  if (!token || !state || !email || !expiresAt) return null

  return (
    `${CLOUD_AUTH_REDIRECT_URI}?` +
    [
      [`token`, token],
      [`state`, state],
      [`email`, email],
      [`expiresAt`, expiresAt],
    ]
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join(`&`)
  )
}

function getParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    root: {
      flex: 1,
      alignItems: `center`,
      justifyContent: `center`,
      gap: spacing.md,
      backgroundColor: tokens.bg,
      paddingHorizontal: spacing.xl,
    },
    text: {
      color: tokens.text2,
      fontSize: fontSize.base,
      lineHeight: lineHeight.base,
      textAlign: `center`,
    },
  })
}
