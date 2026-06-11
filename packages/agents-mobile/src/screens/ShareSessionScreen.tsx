import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'
import {
  userIdFromPrincipal,
  userPrincipalUrl,
} from '@electric-ax/agents-server-ui/src/lib/principals'
import { userDisplay } from '@electric-ax/agents-server-ui/src/lib/userDisplay'
import {
  BottomSheet,
  BottomSheetItem,
  BottomSheetSection,
  BottomSheetSeparator,
} from '../components/BottomSheet'
import { Header, HeaderBackButton } from '../components/Header'
import { Icon, type IconName } from '../components/Icon'
import { Screen } from '../components/Screen'
import { useCopyFeedback } from '../components/useCopyFeedback'
import { useAgents } from '../lib/AgentsProvider'
import { getEntityDisplayTitle } from '../lib/agentsClient'
import {
  ALL_USERS_SUBJECT,
  GrantsRequestError,
  buildShareAccessModel,
  listEntityGrants,
  removeSubjectAccess,
  setSubjectRole,
  type EntityPermissionGrant,
  type ShareSubject,
} from '../lib/entityGrants'
import { sessionIdFromEntityUrl, sessionWebUrl } from '../lib/sessionLinks'
import { useCurrentPrincipal } from '../lib/useCurrentPrincipal'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, monoFontFamily, radii, spacing } from '../lib/theme'
import type { ShareRole } from '@electric-ax/agents-server-ui/src/lib/sharePermissions'
import type { ElectricUser } from '../lib/agentsClient'
import type { Tokens } from '../lib/theme'

const ALL_USERS_KEY = `__all_users__`

// Same role glyphs as the desktop dialog's View/Chat/Manage segments.
const ROLE_OPTIONS: ReadonlyArray<{
  id: ShareRole
  label: string
  description: string
  icon: IconName
}> = [
  { id: `view`, label: `View`, description: `Read-only access`, icon: `eye` },
  {
    id: `chat`,
    label: `Chat`,
    description: `Interact and send messages`,
    icon: `chat`,
  },
  {
    id: `manage`,
    label: `Manage`,
    description: `Full control, incl. sharing`,
    icon: `shield`,
  },
]

const ROLE_LABELS: Record<ShareRole, string> = {
  view: `View`,
  chat: `Chat`,
  manage: `Manage`,
}

/** Subject the role sheet is acting on — a user, or the all-users kind. */
type ShareTarget = {
  key: string
  label: string
  subject: ShareSubject
  role: ShareRole | null
  grants: Array<EntityPermissionGrant>
}

/**
 * Mobile counterpart of the desktop `ShareEntityDialog`, restructured
 * for one column: link sharing (copy / native share sheet), people
 * with access, workspace-wide "General access", then a search-first
 * add-people section. Link actions work for anyone with the session
 * open; the grant sections self-gate on the manage-protected REST
 * endpoint. Roles commit per row through a bottom-sheet picker
 * instead of the desktop's deferred Grant button.
 */
export function ShareSessionScreen({
  entityUrl,
  onBack,
}: {
  entityUrl: string
  onBack: () => void
}): React.ReactElement {
  const { serverUrl, entitiesCollection, usersCollection } = useAgents()
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const { userId: currentUserId } = useCurrentPrincipal()
  const { copiedKey, copy } = useCopyFeedback()

  const [grants, setGrants] = useState<Array<EntityPermissionGrant>>([])
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [roleTarget, setRoleTarget] = useState<ShareTarget | null>(null)
  const [query, setQuery] = useState(``)

  const { data: entities = [] } = useLiveQuery(
    (q) =>
      q
        .from({ entity: entitiesCollection })
        .where(({ entity }) => eq(entity.url, entityUrl)),
    [entitiesCollection, entityUrl]
  )
  const entity = entities[0] ?? null

  const { data: users = [] } = useLiveQuery(
    (q) => q.from({ user: usersCollection }),
    [usersCollection]
  )
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users]
  )

  const loadGrants = useCallback(async () => {
    try {
      const loaded = await listEntityGrants({ baseUrl: serverUrl, entityUrl })
      setGrants(loaded)
      setAccessDenied(false)
    } catch (err) {
      // Losing manage (incl. revoking your own access) is an expected
      // state, not an error to surface.
      if (
        err instanceof GrantsRequestError &&
        (err.status === 401 || err.status === 403)
      ) {
        setAccessDenied(true)
        setError(null)
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setLoadedOnce(true)
    }
  }, [serverUrl, entityUrl])

  useEffect(() => {
    void loadGrants()
  }, [loadGrants])

  const model = useMemo(
    () => buildShareAccessModel(grants, currentUserId),
    [grants, currentUserId]
  )
  const accessRows = useMemo(
    () =>
      model.users
        .map((entry) => ({
          ...entry,
          display: userDisplay(usersById.get(entry.userId), entry.userId),
          user: usersById.get(entry.userId),
        }))
        .sort((a, b) => a.display.primary.localeCompare(b.display.primary)),
    [model.users, usersById]
  )

  const ownerUserId = userIdFromPrincipal(entity?.created_by)
  const ownerDisplay = entity?.created_by
    ? userDisplay(
        ownerUserId ? usersById.get(ownerUserId) : undefined,
        ownerUserId ?? entity.created_by
      )
    : null

  // Add-people candidates: everyone except yourself, the owner and
  // people who already have access (their role is edited in place).
  const grantedUserIds = useMemo(
    () => new Set(model.users.map((entry) => entry.userId)),
    [model.users]
  )
  const addableUsers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return users
      .filter(
        (user) =>
          user.id !== currentUserId &&
          user.id !== ownerUserId &&
          !grantedUserIds.has(user.id)
      )
      .filter(
        (user) => !needle || userSearchText(user).toLowerCase().includes(needle)
      )
      .sort((a, b) => userSearchText(a).localeCompare(userSearchText(b)))
  }, [users, currentUserId, ownerUserId, grantedUserIds, query])

  const userTarget = (entry: {
    userId: string
    role: ShareRole | null
    grants: Array<EntityPermissionGrant>
  }): ShareTarget => ({
    key: entry.userId,
    label: userDisplay(usersById.get(entry.userId), entry.userId).primary,
    subject: { kind: `principal`, value: userPrincipalUrl(entry.userId) },
    role: entry.role,
    grants: entry.grants,
  })
  const allUsersTarget: ShareTarget = {
    key: ALL_USERS_KEY,
    label: `All users`,
    subject: ALL_USERS_SUBJECT,
    role: model.allUsers?.role ?? null,
    grants: model.allUsers?.grants ?? [],
  }

  const shareLink = async (): Promise<void> => {
    const url = sessionWebUrl(serverUrl, entityUrl)
    const title = entity
      ? getEntityDisplayTitle(entity)
      : sessionIdFromEntityUrl(entityUrl)
    try {
      // iOS shares the `url` field; Android only reads `message`.
      await Share.share(
        Platform.OS === `ios` ? { url, title } : { message: url, title }
      )
    } catch {
      // Best-effort: cancellation rejects on some platforms.
    }
  }

  const applyRole = async (
    target: ShareTarget,
    role: ShareRole
  ): Promise<void> => {
    setRoleTarget(null)
    if (target.role === role) return
    setSavingKey(target.key)
    setError(null)
    try {
      await setSubjectRole({
        baseUrl: serverUrl,
        entityUrl,
        subject: target.subject,
        role,
        existingGrants: target.grants,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      // The REST grant list is the source of truth for grant ids, so
      // refetch rather than patching state (desktop parity).
      await loadGrants()
      setSavingKey(null)
    }
  }

  const removeAccess = (target: ShareTarget): void => {
    setRoleTarget(null)
    Alert.alert(
      `Remove access`,
      `Remove ${target.label}'s access to this session?`,
      [
        { text: `Cancel`, style: `cancel` },
        {
          text: `Remove`,
          style: `destructive`,
          onPress: () => {
            void (async () => {
              setSavingKey(target.key)
              setError(null)
              try {
                await removeSubjectAccess({
                  baseUrl: serverUrl,
                  entityUrl,
                  existingGrants: target.grants,
                })
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              } finally {
                await loadGrants()
                setSavingKey(null)
              }
            })()
          },
        },
      ]
    )
  }

  return (
    <Screen>
      <Header
        align="center"
        leading={<HeaderBackButton onPress={onBack} />}
        title="Share session"
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
            {entity && (
              <Text style={styles.introTitle} numberOfLines={2}>
                {getEntityDisplayTitle(entity)}
              </Text>
            )}
            <Pressable
              style={styles.introIdRow}
              onPress={() => copy(`id`, sessionIdFromEntityUrl(entityUrl))}
              hitSlop={6}
            >
              <Text style={styles.introId} numberOfLines={1}>
                {sessionIdFromEntityUrl(entityUrl)}
              </Text>
              <Icon
                name={copiedKey === `id` ? `check` : `copy`}
                size={14}
                color={tokens.text3}
                strokeWidth={2}
              />
            </Pressable>
          </View>

          {/* Link pill (Meet/Zoom-style): the abbreviated URL is the
              content, the trailing glyph the action — one tap opens
              the native share sheet, which includes Copy. */}
          <Text style={styles.sectionLabel}>Session link</Text>
          <TouchableOpacity style={styles.row} onPress={() => void shareLink()}>
            <View style={styles.actionIcon}>
              <Icon
                name="link"
                size={18}
                color={tokens.text2}
                strokeWidth={2}
              />
            </View>
            <Text
              style={styles.linkText}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {sessionWebUrl(serverUrl, entityUrl).replace(/^https?:\/\//, ``)}
            </Text>
            <Icon
              name="share"
              size={18}
              color={tokens.accent11}
              strokeWidth={2}
            />
          </TouchableOpacity>

          {error && (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {accessDenied ? (
            <Text style={styles.empty}>
              You need manage access to view or change who has access to this
              session.
            </Text>
          ) : !loadedOnce ? (
            <ActivityIndicator color={tokens.accent11} />
          ) : (
            <>
              <Text style={styles.sectionLabel}>People with access</Text>
              <View style={styles.list}>
                {ownerDisplay && (
                  <AccessRow
                    tokens={tokens}
                    display={ownerDisplay}
                    user={ownerUserId ? usersById.get(ownerUserId) : undefined}
                    rolePill="Owner"
                  />
                )}
                {accessRows.map((entry) => (
                  <AccessRow
                    key={entry.userId}
                    tokens={tokens}
                    display={entry.display}
                    user={entry.user}
                    rolePill={ROLE_LABELS[entry.role]}
                    saving={savingKey === entry.userId}
                    onPress={() => setRoleTarget(userTarget(entry))}
                  />
                ))}
                {!ownerDisplay && accessRows.length === 0 && (
                  <Text style={styles.empty}>Only the owner has access.</Text>
                )}
              </View>

              <Text style={styles.sectionLabel}>General access</Text>
              <View style={styles.list}>
                <AccessRow
                  tokens={tokens}
                  display={{
                    primary: `All users`,
                    secondary: `Everyone in this workspace`,
                    initials: ``,
                  }}
                  iconName="users"
                  rolePill={
                    allUsersTarget.role
                      ? ROLE_LABELS[allUsersTarget.role]
                      : `No access`
                  }
                  saving={savingKey === ALL_USERS_KEY}
                  onPress={() => setRoleTarget(allUsersTarget)}
                />
              </View>

              <Text style={styles.sectionLabel}>Add people</Text>
              <View style={styles.searchWrap}>
                <Icon
                  name="search"
                  size={18}
                  color={tokens.text3}
                  strokeWidth={2}
                />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search users"
                  placeholderTextColor={tokens.text3}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.searchInput}
                />
              </View>
              <View style={styles.list}>
                {addableUsers.map((user) => (
                  <AccessRow
                    key={user.id}
                    tokens={tokens}
                    display={userDisplay(user, user.id)}
                    user={user}
                    saving={savingKey === user.id}
                    onPress={() =>
                      setRoleTarget(
                        userTarget({ userId: user.id, role: null, grants: [] })
                      )
                    }
                  />
                ))}
                {addableUsers.length === 0 && (
                  <Text style={styles.empty}>
                    {users.length === 0
                      ? `No users available on this server.`
                      : `No matching users.`}
                  </Text>
                )}
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <BottomSheet
        open={roleTarget !== null}
        onClose={() => setRoleTarget(null)}
        title={roleTarget?.label}
      >
        <BottomSheetSection label="Access level">
          {ROLE_OPTIONS.map((option) => (
            <BottomSheetItem
              key={option.id}
              label={option.label}
              subtitle={option.description}
              icon={
                <Icon
                  name={option.icon}
                  size={18}
                  color={tokens.text2}
                  strokeWidth={2}
                />
              }
              active={roleTarget?.role === option.id}
              onPress={() => {
                if (roleTarget) void applyRole(roleTarget, option.id)
              }}
            />
          ))}
        </BottomSheetSection>
        {roleTarget?.role && (
          <>
            <BottomSheetSeparator />
            <BottomSheetSection>
              <BottomSheetItem
                label="Remove access"
                destructive
                icon={
                  <Icon
                    name="close"
                    size={18}
                    color={tokens.red11}
                    strokeWidth={2}
                  />
                }
                onPress={() => {
                  if (roleTarget) removeAccess(roleTarget)
                }}
              />
            </BottomSheetSection>
          </>
        )}
      </BottomSheet>
    </Screen>
  )
}

function AccessRow({
  tokens,
  display,
  user,
  iconName,
  rolePill,
  saving,
  onPress,
}: {
  tokens: Tokens
  display: { primary: string; secondary: string; initials: string }
  user?: ElectricUser
  iconName?: `users`
  rolePill?: string
  saving?: boolean
  onPress?: () => void
}): React.ReactElement {
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const row = (
    <>
      {iconName ? (
        <View style={styles.avatar}>
          <Icon
            name={iconName}
            size={16}
            color={tokens.text2}
            strokeWidth={2}
          />
        </View>
      ) : user?.avatar_url ? (
        <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
      ) : (
        <View style={styles.avatar}>
          <Text style={styles.avatarInitials}>{display.initials}</Text>
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowPrimary} numberOfLines={1}>
          {display.primary}
        </Text>
        <Text style={styles.rowSecondary} numberOfLines={1}>
          {display.secondary}
        </Text>
      </View>
      {saving ? (
        <ActivityIndicator size="small" color={tokens.text3} />
      ) : (
        <>
          {rolePill && <Text style={styles.rolePill}>{rolePill}</Text>}
          {onPress && (
            <Icon
              name="chevron-right"
              size={16}
              color={tokens.text3}
              strokeWidth={2}
            />
          )}
        </>
      )}
    </>
  )

  if (!onPress) return <View style={styles.row}>{row}</View>
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={saving}>
      {row}
    </TouchableOpacity>
  )
}

function userSearchText(user: ElectricUser): string {
  return [user.display_name, user.email, user.id].filter(Boolean).join(` `)
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    keyboard: {
      flex: 1,
    },
    content: {
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
      gap: spacing.md,
    },
    intro: {
      gap: 2,
    },
    introTitle: {
      color: tokens.text1,
      fontSize: fontSize.lg,
      fontWeight: `500`,
    },
    introIdRow: {
      alignSelf: `flex-start`,
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.xs,
      maxWidth: `100%`,
    },
    introId: {
      flexShrink: 1,
      color: tokens.text3,
      fontSize: fontSize.sm,
      fontFamily: monoFontFamily,
    },
    actionIcon: {
      width: 32,
      alignItems: `center`,
      justifyContent: `center`,
    },
    linkText: {
      flex: 1,
      color: tokens.text2,
      fontSize: fontSize.sm,
      fontFamily: monoFontFamily,
    },
    sectionLabel: {
      marginTop: spacing.sm,
      color: tokens.text3,
      fontSize: fontSize.xs,
      fontWeight: `500`,
      letterSpacing: 0.6,
      textTransform: `uppercase`,
    },
    list: {
      gap: spacing.xs,
    },
    row: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.md,
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.md,
      backgroundColor: tokens.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: tokens.accentA2,
      alignItems: `center`,
      justifyContent: `center`,
    },
    avatarInitials: {
      color: tokens.accent11,
      fontSize: fontSize.xs,
      fontWeight: `600`,
    },
    rowText: {
      flex: 1,
      gap: 1,
    },
    rowPrimary: {
      color: tokens.text1,
      fontSize: fontSize.base,
      fontWeight: `500`,
    },
    rowSecondary: {
      color: tokens.text3,
      fontSize: fontSize.sm,
    },
    rolePill: {
      color: tokens.text2,
      fontSize: fontSize.xs,
      fontWeight: `500`,
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      overflow: `hidden`,
    },
    // Field metrics mirror `SearchBar` — fixed height with a
    // zero-padding input keeps the placeholder vertically centred on
    // both platforms (Android adds intrinsic vertical padding).
    searchWrap: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.xs,
      height: 36,
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.md,
      backgroundColor: tokens.surface,
      paddingHorizontal: 10,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      color: tokens.text1,
      fontSize: fontSize.lg,
      paddingVertical: 0,
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
    empty: {
      color: tokens.text3,
      fontSize: fontSize.sm,
    },
  })
}
