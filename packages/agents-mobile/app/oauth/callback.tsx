import { useEffect, useMemo, useRef } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { CLOUD_AUTH_REDIRECT_URI, cloudAuth } from '../../src/lib/cloudAuth'
import { useTokens } from '../../src/lib/ThemeProvider'
import { fontSize, lineHeight, spacing } from '../../src/lib/theme'
import type { Tokens } from '../../src/lib/theme'

export default function OAuthCallbackRoute(): React.ReactElement {
  const router = useRouter()
  const params = useLocalSearchParams()
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const completedRef = useRef(false)

  useEffect(() => {
    if (completedRef.current) return
    completedRef.current = true

    const callbackUrl = buildCallbackUrl(params)
    if (!callbackUrl) {
      router.replace(`/`)
      return
    }

    let cancelled = false
    void cloudAuth.completeCallbackUrl(callbackUrl).finally(() => {
      if (!cancelled) router.replace(`/`)
    })

    return () => {
      cancelled = true
    }
  }, [params, router])

  return (
    <View style={styles.root}>
      <ActivityIndicator color={tokens.accent11} />
      <Text style={styles.text}>Finishing sign-in…</Text>
    </View>
  )
}

function buildCallbackUrl(params: ReturnType<typeof useLocalSearchParams>) {
  const token = getParam(params.token)
  const state = getParam(params.state)
  const email = getParam(params.email)
  const expiresAt = getParam(params.expiresAt)
  if (!token || !state || !email || !expiresAt) return null

  const url = new URL(CLOUD_AUTH_REDIRECT_URI)
  url.searchParams.set(`token`, token)
  url.searchParams.set(`state`, state)
  url.searchParams.set(`email`, email)
  url.searchParams.set(`expiresAt`, expiresAt)
  return url.toString()
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
