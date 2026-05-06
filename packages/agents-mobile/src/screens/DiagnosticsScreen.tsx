import { useCallback, useEffect, useMemo, useState } from 'react'
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import Constants from 'expo-constants'
import { Header, HeaderBackButton } from '../components/Header'
import { PrimaryButton } from '../components/PrimaryButton'
import { Screen } from '../components/Screen'
import { useAgents } from '../lib/AgentsProvider'
import { checkServerHealth } from '../lib/agentsClient'
import { useColorSchemeMode, useTokens } from '../lib/ThemeProvider'
import { fontSize, lineHeight, radii, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'

type HealthState =
  | { kind: `idle` }
  | { kind: `pending` }
  | { kind: `ok`; latencyMs: number; checkedAt: number }
  | { kind: `error`; message: string; checkedAt: number }

/**
 * "What's broken?" view.
 *
 * v1 surfaces the bare minimum needed to triage a stuck mobile
 * session without attaching a debugger:
 *
 *   - Active server URL + a one-shot health probe with latency
 *   - App / Expo / OS version strings
 *
 * Everything is plain text + monospaced values so the user can
 * screenshot the page and send it over.
 */
export function DiagnosticsScreen({
  onBack,
}: {
  onBack: () => void
}): React.ReactElement {
  const { serverUrl } = useAgents()
  const tokens = useTokens()
  const scheme = useColorSchemeMode()
  const styles = useMemo(() => createStyles(tokens), [tokens])

  const [health, setHealth] = useState<HealthState>({ kind: `idle` })

  const probe = useCallback(async () => {
    setHealth({ kind: `pending` })
    const start = Date.now()
    try {
      await checkServerHealth(serverUrl)
      setHealth({
        kind: `ok`,
        latencyMs: Date.now() - start,
        checkedAt: Date.now(),
      })
    } catch (err) {
      setHealth({
        kind: `error`,
        message: err instanceof Error ? err.message : String(err),
        checkedAt: Date.now(),
      })
    }
  }, [serverUrl])

  useEffect(() => {
    void probe()
  }, [probe])

  const appVersion = Constants.expoConfig?.version ?? `0.0.0`
  const sdkVersion = Constants.expoConfig?.sdkVersion ?? Constants.sdkVersion
  const osVersion =
    Platform.OS === `ios` ? Platform.Version : `${Platform.Version}`

  return (
    <Screen>
      <Header
        align="center"
        leading={<HeaderBackButton onPress={onBack} />}
        title="Diagnostics"
      />

      <ScrollView contentContainerStyle={styles.content}>
        <Section label="Server" tokens={tokens}>
          <Field label="URL" value={serverUrl} mono tokens={tokens} />
          <Field
            label="Health"
            tokens={tokens}
            value={
              health.kind === `pending`
                ? `Checking…`
                : health.kind === `ok`
                  ? `OK · ${health.latencyMs} ms`
                  : health.kind === `error`
                    ? `Down · ${health.message}`
                    : `—`
            }
            tone={
              health.kind === `ok`
                ? `ok`
                : health.kind === `error`
                  ? `error`
                  : `neutral`
            }
          />
          <View style={styles.actionRow}>
            <PrimaryButton
              title={health.kind === `pending` ? `Probing…` : `Re-check`}
              variant="soft"
              loading={health.kind === `pending`}
              onPress={() => void probe()}
            />
          </View>
        </Section>

        <Section label="System" tokens={tokens}>
          <Field label="App version" value={appVersion} tokens={tokens} />
          <Field
            label="Expo SDK"
            value={sdkVersion ?? `unknown`}
            tokens={tokens}
          />
          <Field
            label="Platform"
            value={`${Platform.OS} ${osVersion}`}
            tokens={tokens}
          />
          <Field label="Theme" value={`${scheme} (resolved)`} tokens={tokens} />
        </Section>
      </ScrollView>
    </Screen>
  )
}

function Section({
  label,
  tokens,
  children,
}: {
  label: string
  tokens: Tokens
  children: React.ReactNode
}): React.ReactElement {
  const styles = useMemo(() => createStyles(tokens), [tokens])
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  )
}

function Field({
  label,
  value,
  mono,
  tone = `neutral`,
  tokens,
}: {
  label: string
  value: string
  mono?: boolean
  tone?: `neutral` | `ok` | `error`
  tokens: Tokens
}): React.ReactElement {
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const valueColor =
    tone === `ok`
      ? tokens.green11
      : tone === `error`
        ? tokens.red11
        : tokens.text1
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text
        style={[
          styles.fieldValue,
          mono ? styles.fieldValueMono : null,
          { color: valueColor },
        ]}
        selectable
      >
        {value}
      </Text>
    </View>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    content: {
      padding: spacing.md,
      gap: spacing.lg,
    },
    section: {
      gap: spacing.xs,
    },
    sectionLabel: {
      paddingHorizontal: spacing.xs,
      color: tokens.text3,
      fontSize: 11,
      fontWeight: `500`,
      textTransform: `uppercase`,
      letterSpacing: 0.6,
    },
    sectionBody: {
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.md,
      backgroundColor: tokens.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    field: {
      gap: 2,
    },
    fieldLabel: {
      color: tokens.text3,
      fontSize: fontSize.xs,
    },
    fieldValue: {
      fontSize: fontSize.sm,
      lineHeight: lineHeight.sm,
    },
    fieldValueMono: {
      fontFamily: Platform.OS === `ios` ? `Menlo` : `monospace`,
    },
    actionRow: {
      flexDirection: `row`,
      alignSelf: `flex-start`,
      paddingTop: spacing.xs,
    },
  })
}
