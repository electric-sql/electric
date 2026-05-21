import { useMemo, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useLiveQuery } from '@tanstack/react-db'
import { Header, HeaderBackButton } from '../components/Header'
import { PrimaryButton } from '../components/PrimaryButton'
import { Screen } from '../components/Screen'
import { useAgents } from '../lib/AgentsProvider'
import { spawnEntity, type ElectricEntityType } from '../lib/agentsClient'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, lineHeight, radii, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'

const DEFAULT_AGENT_NAME = `horton`

export function NewSessionScreen({
  onBack,
  onOpenSession,
}: {
  onBack: () => void
  onOpenSession: (entityUrl: string) => void
}): React.ReactElement {
  const { entityTypesCollection, serverUrl } = useAgents()
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const [message, setMessage] = useState(``)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: entityTypes = [] } = useLiveQuery(
    (query) =>
      query
        .from({ type: entityTypesCollection })
        .orderBy(({ type }) => type.name, `asc`),
    [entityTypesCollection]
  )

  const visibleTypes = useMemo(
    () => entityTypes.filter((type) => type.name !== `worker`),
    [entityTypes]
  )
  const defaultType = useMemo(
    () =>
      visibleTypes.find((type) => type.name === DEFAULT_AGENT_NAME) ??
      visibleTypes[0] ??
      null,
    [visibleTypes]
  )
  const activeTypeName = selectedType ?? defaultType?.name ?? null

  const start = async () => {
    if (!activeTypeName || loading) return
    setLoading(true)
    setError(null)
    try {
      const entityUrl = await spawnEntity({
        baseUrl: serverUrl,
        type: activeTypeName,
        initialMessage: message,
      })
      onOpenSession(entityUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Screen>
      <Header
        align="center"
        leading={<HeaderBackButton onPress={onBack} />}
        title="New session"
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === `ios` ? `padding` : undefined}
        style={styles.keyboard}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <View style={styles.intro}>
            <Text style={styles.title}>What should we work on?</Text>
            <Text style={styles.copy}>
              Mobile uses the server default working directory for now.
            </Text>
          </View>

          <View style={styles.composerWrap}>
            <TextInput
              multiline
              value={message}
              onChangeText={setMessage}
              placeholder={
                defaultType
                  ? `Ask ${defaultType.name} anything...`
                  : `Ask an agent...`
              }
              placeholderTextColor={tokens.text3}
              style={styles.composer}
            />
          </View>

          <Text style={styles.sectionLabel}>Agent type</Text>
          <View style={styles.typeList}>
            {visibleTypes.map((type) => (
              <AgentTypeCard
                key={type.name}
                type={type}
                tokens={tokens}
                selected={type.name === activeTypeName}
                onPress={() => setSelectedType(type.name)}
              />
            ))}
          </View>

          {visibleTypes.length === 0 && (
            <Text style={styles.empty}>
              No entity types are registered on this server.
            </Text>
          )}

          {error && (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.footer}>
            <PrimaryButton
              title="Start session"
              loading={loading}
              disabled={!activeTypeName || loading}
              onPress={start}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

function AgentTypeCard({
  type,
  tokens,
  selected,
  onPress,
}: {
  type: ElectricEntityType
  tokens: Tokens
  selected: boolean
  onPress: () => void
}): React.ReactElement {
  const styles = useMemo(() => createStyles(tokens), [tokens])
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.typeCard, selected ? styles.typeCardSelected : null]}
    >
      <Text style={styles.typeName}>{type.name}</Text>
      {type.description ? (
        <Text numberOfLines={2} style={styles.typeDescription}>
          {type.description}
        </Text>
      ) : null}
    </TouchableOpacity>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    keyboard: {
      flex: 1,
    },
    content: {
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
      gap: spacing.lg,
    },
    intro: {
      gap: spacing.sm,
    },
    title: {
      color: tokens.text1,
      fontSize: fontSize.xxxl,
      fontWeight: `400`,
      lineHeight: lineHeight.xxxl,
    },
    copy: {
      color: tokens.text2,
      fontSize: fontSize.base,
      lineHeight: lineHeight.base,
    },
    composerWrap: {
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.xl,
      backgroundColor: tokens.surfaceRaised,
    },
    composer: {
      minHeight: 132,
      color: tokens.text1,
      fontSize: fontSize.sm,
      lineHeight: lineHeight.base,
      padding: spacing.md,
      textAlignVertical: `top`,
    },
    sectionLabel: {
      marginTop: spacing.sm,
      color: tokens.text3,
      fontSize: fontSize.xs,
      fontWeight: `500`,
      letterSpacing: 0.6,
      textTransform: `uppercase`,
    },
    typeList: {
      gap: spacing.xs,
    },
    typeCard: {
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.md,
      backgroundColor: tokens.surface,
      padding: spacing.md,
    },
    typeCardSelected: {
      borderColor: tokens.accentA6,
      backgroundColor: tokens.accentA2,
    },
    typeName: {
      color: tokens.text1,
      fontSize: fontSize.base,
      fontWeight: `500`,
    },
    typeDescription: {
      marginTop: spacing.xs,
      color: tokens.text2,
      fontSize: fontSize.sm,
      lineHeight: lineHeight.sm,
    },
    empty: {
      color: tokens.text3,
      fontSize: fontSize.sm,
    },
    errorRow: {
      borderRadius: radii.sm,
      backgroundColor: tokens.redA2,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    errorText: {
      color: tokens.red11,
      fontSize: fontSize.sm,
    },
    footer: {
      flexDirection: `row`,
      justifyContent: `flex-end`,
    },
  })
}
