import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
} from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { Eye, Link2, MessageSquare, Share2, ShieldCheck, X } from 'lucide-react'
import { entityApiUrl } from '../lib/entity-api'
import { sessionAppUrl } from '../lib/sessionLinks'
import { serverFetch } from '../lib/auth-fetch'
import {
  SHARE_PERMISSIONS,
  SHARE_ROLE_PERMISSIONS,
  roleFromGrants,
  rolePermissionsMatchGrants,
  type SharePermission,
  type ShareRole,
} from '../lib/sharePermissions'
import { showToast } from '../lib/toast'
import { useServerConnection } from '../hooks/useServerConnection'
import { useCurrentPrincipal } from '../hooks/useCurrentPrincipal'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { userIdFromPrincipal, userPrincipalUrl } from '../lib/principals'
import { userDisplay, userSearchText } from '../lib/userDisplay'
import { Button, Dialog, Icon, IconButton, Input, Text, Tooltip } from '../ui'
import type {
  ElectricEntity,
  ElectricUser,
} from '../lib/ElectricAgentsProvider'
import type { LucideIcon } from 'lucide-react'
import styles from './ShareEntityDialog.module.css'

type EntityPermissionGrant = {
  id: number
  entity_url: string
  permission: SharePermission | string
  subject_kind: PermissionSubjectKind | string
  subject_value: string
  propagation?: `self` | `descendants` | string
  copy_to_children?: boolean
  created_by?: string
  expires_at?: string
  created_at: string
  updated_at: string
}

type PermissionSubjectKind = `principal` | `principal_kind`

type ShareTargetDisplay = {
  primary: string
  secondary: string
  initials: string
}

type SharedAccessRowModel = {
  targetId: string
  display: ShareTargetDisplay
  user?: ElectricUser
  role: ShareRole
}

const ALL_USERS_TARGET_ID = `__all_users__`
const ALL_USERS_SUBJECT_KIND = `principal_kind`
const ALL_USERS_SUBJECT_VALUE = `user`
const ALL_USERS_DISPLAY: ShareTargetDisplay = {
  primary: `All users`,
  secondary: `Everyone in this workspace`,
  initials: `AU`,
}
const ALL_USERS_SEARCH_TEXT = `all users everyone workspace`

const ROLE_OPTIONS: Array<{
  id: ShareRole
  label: string
  icon: LucideIcon
  permissions: ReadonlyArray<SharePermission>
}> = [
  {
    id: `view`,
    label: `View`,
    icon: Eye,
    permissions: SHARE_ROLE_PERMISSIONS.view,
  },
  {
    id: `chat`,
    label: `Chat`,
    icon: MessageSquare,
    permissions: SHARE_ROLE_PERMISSIONS.chat,
  },
  {
    id: `manage`,
    label: `Manage`,
    icon: ShieldCheck,
    permissions: SHARE_ROLE_PERMISSIONS.manage,
  },
]

const ROLE_BY_ID = new Map(ROLE_OPTIONS.map((role) => [role.id, role]))

export function ShareEntityDialog({
  entity,
}: {
  entity: ElectricEntity
}): React.ReactElement {
  const { activeServer } = useServerConnection()
  const { usersCollection } = useElectricAgents()
  const baseUrl = activeServer?.url ?? ``

  const copySessionLink = async (): Promise<void> => {
    if (!baseUrl) return
    const link = sessionAppUrl(baseUrl, entity.url)
    try {
      await navigator.clipboard.writeText(link)
      showToast({ title: `Session link copied`, tone: `success` })
    } catch {
      showToast({ title: `Couldn't copy link`, tone: `danger` })
    }
  }

  const [open, setOpen] = useState(false)
  const [grants, setGrants] = useState<Array<EntityPermissionGrant>>([])
  const [loadingGrants, setLoadingGrants] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState(``)
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(
    ALL_USERS_TARGET_ID
  )
  const [selectedRole, setSelectedRole] = useState<ShareRole>(`chat`)
  const { userId: currentUserId } = useCurrentPrincipal()

  const { data: users = [] } = useLiveQuery(
    (q) => {
      if (!usersCollection) return undefined
      return q.from({ user: usersCollection })
    },
    [usersCollection]
  )

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) =>
      userSearchText(a).localeCompare(userSearchText(b))
    )
  }, [users])

  const shareableUsers = useMemo(() => {
    if (!currentUserId) return sortedUsers
    return sortedUsers.filter((user) => user.id !== currentUserId)
  }, [currentUserId, sortedUsers])

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return shareableUsers
    return shareableUsers.filter((user) =>
      userSearchText(user).toLowerCase().includes(needle)
    )
  }, [query, shareableUsers])

  const showAllUsersTarget = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return !needle || ALL_USERS_SEARCH_TEXT.includes(needle)
  }, [query])

  const visibleTargetCount = filteredUsers.length + (showAllUsersTarget ? 1 : 0)

  const usersById = useMemo(
    () => new Map(sortedUsers.map((user) => [user.id, user])),
    [sortedUsers]
  )

  const grantsByUserId = useMemo(() => {
    const grouped = new Map<string, Array<EntityPermissionGrant>>()
    for (const grant of grants) {
      if (grant.subject_kind !== `principal`) continue
      const userId = userIdFromPrincipal(grant.subject_value)
      if (!userId) continue
      const existing = grouped.get(userId)
      if (existing) existing.push(grant)
      else grouped.set(userId, [grant])
    }
    return grouped
  }, [grants])

  const allUsersGrants = useMemo(() => grants.filter(isAllUsersGrant), [grants])

  const allUsersRole = useMemo(
    () => roleFromGrants(allUsersGrants),
    [allUsersGrants]
  )

  const roleByUserId = useMemo(() => {
    const roles = new Map<string, ShareRole>()
    for (const [userId, userGrants] of grantsByUserId) {
      const role = roleFromGrants(userGrants)
      if (role) roles.set(userId, role)
    }
    return roles
  }, [grantsByUserId])

  const sharedRows = useMemo(() => {
    const rows: Array<SharedAccessRowModel> = []
    if (allUsersRole) {
      rows.push({
        targetId: ALL_USERS_TARGET_ID,
        display: ALL_USERS_DISPLAY,
        role: allUsersRole,
      })
    }

    const userRows = [...roleByUserId.entries()]
      .filter(([userId]) => userId !== currentUserId)
      .map(([userId, role]) => ({
        targetId: userId,
        display: userDisplay(usersById.get(userId), userId),
        userId,
        user: usersById.get(userId),
        role,
      }))
      .sort((a, b) => a.display.primary.localeCompare(b.display.primary))

    rows.push(...userRows)
    return rows
  }, [allUsersRole, currentUserId, roleByUserId, usersById])

  const selectedTargetIsAllUsers = selectedTargetId === ALL_USERS_TARGET_ID
  const selectedUserId = selectedTargetIsAllUsers ? null : selectedTargetId
  const selectedUser = selectedUserId
    ? usersById.get(selectedUserId)
    : undefined
  const selectedDisplay = selectedTargetIsAllUsers
    ? ALL_USERS_DISPLAY
    : selectedUserId
      ? userDisplay(selectedUser, selectedUserId)
      : null
  const selectedExistingRole = selectedTargetIsAllUsers
    ? allUsersRole
    : selectedUserId
      ? (roleByUserId.get(selectedUserId) ?? null)
      : null
  const selectedExistingGrants = useMemo(() => {
    if (selectedTargetId === ALL_USERS_TARGET_ID) return allUsersGrants
    return selectedTargetId ? (grantsByUserId.get(selectedTargetId) ?? []) : []
  }, [allUsersGrants, grantsByUserId, selectedTargetId])
  const selectedRoleChanged =
    selectedTargetId !== null &&
    !rolePermissionsMatchGrants(selectedRole, selectedExistingGrants)

  useEffect(() => {
    if (!open) return
    if (selectedTargetId === ALL_USERS_TARGET_ID) return
    if (
      selectedTargetId &&
      selectedTargetId !== currentUserId &&
      usersById.has(selectedTargetId)
    ) {
      return
    }
    setSelectedTargetId(ALL_USERS_TARGET_ID)
  }, [currentUserId, open, selectedTargetId, usersById])

  useEffect(() => {
    if (!open || !selectedTargetId) return
    const existingRole =
      selectedTargetId === ALL_USERS_TARGET_ID
        ? allUsersRole
        : roleByUserId.get(selectedTargetId)
    setSelectedRole(existingRole ?? `chat`)
  }, [allUsersRole, open, roleByUserId, selectedTargetId])

  const loadGrants = useCallback(async () => {
    if (!baseUrl) return
    setLoadingGrants(true)
    setError(null)
    try {
      // The synced effective-permissions shape is scoped to the current
      // principal. Sharing needs the manager-only raw grant set for this
      // entity, so load it through the manage-protected REST endpoint.
      const res = await serverFetch(
        entityApiUrl(baseUrl, entity.url, `/grants`)
      )
      await assertOk(res, `Load grants`)
      const data = (await res.json()) as {
        grants?: Array<EntityPermissionGrant>
      }
      setGrants(Array.isArray(data.grants) ? data.grants : [])
    } catch (err) {
      const message = errorMessage(err)
      setError(message)
      setGrants([])
    } finally {
      setLoadingGrants(false)
    }
  }, [baseUrl, entity.url])

  useEffect(() => {
    if (!open) return
    void loadGrants()
  }, [loadGrants, open])

  const saveSelectedRole = async () => {
    if (!baseUrl || !selectedTargetId) return
    if (selectedUserId === currentUserId) return
    const role = ROLE_BY_ID.get(selectedRole)
    if (!role) return

    setSaving(true)
    setError(null)
    try {
      const subjectKind: PermissionSubjectKind = selectedTargetIsAllUsers
        ? ALL_USERS_SUBJECT_KIND
        : `principal`
      const subjectValue = selectedTargetIsAllUsers
        ? ALL_USERS_SUBJECT_VALUE
        : userPrincipalUrl(selectedUserId!)
      const existing = selectedExistingGrants.filter((grant) =>
        SHARE_PERMISSIONS.has(grant.permission)
      )
      const desired = new Set<string>(role.permissions)
      const existingPermissions = new Set(
        existing.map((grant) => grant.permission)
      )
      const deleteRequests = existing
        .filter((grant) => !desired.has(grant.permission))
        .map((grant) => deleteGrant(baseUrl, entity.url, grant.id))
      const createRequests = role.permissions
        .filter((permission) => !existingPermissions.has(permission))
        .map((permission) =>
          createGrant(
            baseUrl,
            entity.url,
            subjectKind,
            subjectValue,
            permission
          )
        )

      await Promise.all([...deleteRequests, ...createRequests])
      await loadGrants()
      showToast({
        tone: `success`,
        title: `Permissions updated`,
        description: selectedDisplay?.primary,
      })
    } catch (err) {
      const message = errorMessage(err)
      setError(message)
      showToast({
        tone: `danger`,
        title: `Sharing failed`,
        description: message,
      })
    } finally {
      setSaving(false)
    }
  }

  const removeTarget = async (targetId: string) => {
    if (!baseUrl) return
    setSaving(true)
    setError(null)
    try {
      const targetIsAllUsers = targetId === ALL_USERS_TARGET_ID
      const grantsToDelete = (
        targetIsAllUsers ? allUsersGrants : (grantsByUserId.get(targetId) ?? [])
      ).filter((grant) => SHARE_PERMISSIONS.has(grant.permission))
      await Promise.all(
        grantsToDelete.map((grant) =>
          deleteGrant(baseUrl, entity.url, grant.id)
        )
      )
      await loadGrants()
      showToast({
        tone: `success`,
        title: `Access removed`,
        description: targetIsAllUsers
          ? ALL_USERS_DISPLAY.primary
          : userDisplay(usersById.get(targetId), targetId).primary,
      })
    } catch (err) {
      const message = errorMessage(err)
      setError(message)
      showToast({
        tone: `danger`,
        title: `Remove failed`,
        description: message,
      })
    } finally {
      setSaving(false)
    }
  }

  const saveDisabled =
    !baseUrl ||
    !selectedTargetId ||
    !selectedRoleChanged ||
    saving ||
    loadingGrants

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={
          <ShareTrigger
            variant="ghost"
            tone="neutral"
            size={1}
            aria-label="Share chat"
            title="Share chat"
          />
        }
      />
      <Dialog.Content maxWidth={680}>
        <Dialog.Header closeAriaLabel="Close sharing">
          <Dialog.Title>Share chat</Dialog.Title>
          <Dialog.Description>
            {entity.url.replace(/^\//, ``)}
          </Dialog.Description>
        </Dialog.Header>

        <Dialog.Body>
          {error && (
            <div className={styles.error} role="alert">
              <Text size={2} tone="danger">
                {error}
              </Text>
            </div>
          )}

          <div className={styles.grid}>
            <section className={styles.userPicker}>
              <Input
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search users"
                aria-label="Search users"
                size={2}
              />
              <div className={styles.userList}>
                {showAllUsersTarget && (
                  <TargetButton
                    key={ALL_USERS_TARGET_ID}
                    display={ALL_USERS_DISPLAY}
                    active={selectedTargetId === ALL_USERS_TARGET_ID}
                    role={allUsersRole ?? null}
                    onClick={() => setSelectedTargetId(ALL_USERS_TARGET_ID)}
                  />
                )}
                {filteredUsers.map((user) => (
                  <TargetButton
                    key={user.id}
                    display={userDisplay(user, user.id)}
                    user={user}
                    active={user.id === selectedTargetId}
                    role={roleByUserId.get(user.id) ?? null}
                    onClick={() => setSelectedTargetId(user.id)}
                  />
                ))}
                {visibleTargetCount === 0 && (
                  <Text size={2} tone="muted" className={styles.empty}>
                    No matching users.
                  </Text>
                )}
              </div>
            </section>

            <section className={styles.rolePanel}>
              {selectedDisplay ? (
                <>
                  <TargetSummary
                    display={selectedDisplay}
                    user={selectedUser}
                  />
                  <div className={styles.segmented} role="group">
                    {ROLE_OPTIONS.map((role) => {
                      const active = role.id === selectedRole
                      return (
                        <button
                          key={role.id}
                          type="button"
                          className={styles.segment}
                          aria-pressed={active}
                          onClick={() => setSelectedRole(role.id)}
                        >
                          <Icon icon={role.icon} size={2} />
                          <span>{role.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : (
                <Text size={2} tone="muted">
                  Select who to share with.
                </Text>
              )}
            </section>
          </div>

          <section className={styles.sharedSection}>
            <div className={styles.sectionHeader}>
              <Text size={2} weight="medium">
                People with access
              </Text>
              {loadingGrants && (
                <Text size={1} tone="muted">
                  Loading...
                </Text>
              )}
            </div>
            <div className={styles.sharedList}>
              {sharedRows.map((row) => (
                <SharedAccessRow
                  key={row.targetId}
                  display={row.display}
                  user={row.user}
                  role={row.role}
                  disabled={saving}
                  onRemove={() => void removeTarget(row.targetId)}
                />
              ))}
              {!loadingGrants && sharedRows.length === 0 && (
                <Text size={2} tone="muted" className={styles.empty}>
                  No grants yet.
                </Text>
              )}
            </div>
          </section>
        </Dialog.Body>

        <Dialog.Footer>
          <Button
            variant="soft"
            tone="neutral"
            onClick={() => void copySessionLink()}
            disabled={!baseUrl}
            style={{ marginRight: `auto` }}
          >
            <Icon icon={Link2} size={1} />
            Copy session link
          </Button>
          <Dialog.Close
            render={
              <Button variant="soft" tone="neutral" disabled={saving}>
                Cancel
              </Button>
            }
          />
          <Button
            onClick={() => void saveSelectedRole()}
            disabled={saveDisabled}
          >
            {selectedExistingRole ? `Update` : `Grant`}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}

const ShareTrigger = forwardRef<
  HTMLElement,
  Omit<ComponentProps<typeof IconButton>, `children`>
>(function ShareTrigger(props, ref): React.ReactElement {
  return (
    <Tooltip content="Share chat">
      <IconButton ref={ref} {...props}>
        <Icon icon={Share2} size={2} />
      </IconButton>
    </Tooltip>
  )
})

function TargetButton({
  display,
  user,
  active,
  role,
  onClick,
}: {
  display: ShareTargetDisplay
  user?: ElectricUser
  active: boolean
  role: ShareRole | null
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      className={styles.userRow}
      aria-pressed={active}
      onClick={onClick}
    >
      <Avatar user={user} fallback={display.initials} />
      <span className={styles.userText}>
        <span className={styles.userPrimary}>{display.primary}</span>
        <span className={styles.userSecondary}>{display.secondary}</span>
      </span>
      {role && <span className={styles.rolePill}>{roleLabel(role)}</span>}
    </button>
  )
}

function TargetSummary({
  display,
  user,
}: {
  display: ShareTargetDisplay
  user?: ElectricUser
}): React.ReactElement {
  return (
    <div className={styles.userSummary}>
      <Avatar user={user} fallback={display.initials} size="large" />
      <span className={styles.userText}>
        <span className={styles.summaryPrimary}>{display.primary}</span>
        <span className={styles.userSecondary}>{display.secondary}</span>
      </span>
    </div>
  )
}

function SharedAccessRow({
  display,
  user,
  role,
  disabled,
  onRemove,
}: {
  display: ShareTargetDisplay
  user?: ElectricUser
  role: ShareRole
  disabled: boolean
  onRemove: () => void
}): React.ReactElement {
  return (
    <div className={styles.sharedRow}>
      <Avatar user={user} fallback={display.initials} />
      <span className={styles.userText}>
        <span className={styles.userPrimary}>{display.primary}</span>
        <span className={styles.userSecondary}>{display.secondary}</span>
      </span>
      <span className={styles.rolePill}>{roleLabel(role)}</span>
      <IconButton
        type="button"
        variant="ghost"
        tone="neutral"
        size={1}
        aria-label={`Remove access for ${display.primary}`}
        title={`Remove access for ${display.primary}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <Icon icon={X} size={2} />
      </IconButton>
    </div>
  )
}

function Avatar({
  user,
  fallback,
  size = `default`,
}: {
  user?: ElectricUser
  fallback: string
  size?: `default` | `large`
}): React.ReactElement {
  if (user?.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt=""
        className={[styles.avatar, size === `large` ? styles.avatarLarge : null]
          .filter(Boolean)
          .join(` `)}
      />
    )
  }
  return (
    <span
      className={[styles.avatar, size === `large` ? styles.avatarLarge : null]
        .filter(Boolean)
        .join(` `)}
      aria-hidden="true"
    >
      {fallback}
    </span>
  )
}

async function createGrant(
  baseUrl: string,
  entityUrl: string,
  subjectKind: PermissionSubjectKind,
  subjectValue: string,
  permission: SharePermission
): Promise<void> {
  const res = await serverFetch(entityApiUrl(baseUrl, entityUrl, `/grants`), {
    method: `POST`,
    headers: { 'content-type': `application/json` },
    body: JSON.stringify({
      subject_kind: subjectKind,
      subject_value: subjectValue,
      permission,
    }),
  })
  await assertOk(res, `Create grant`)
}

async function deleteGrant(
  baseUrl: string,
  entityUrl: string,
  grantId: number
): Promise<void> {
  const res = await serverFetch(
    entityApiUrl(baseUrl, entityUrl, `/grants/${grantId}`),
    { method: `DELETE` }
  )
  await assertOk(res, `Delete grant`)
}

async function assertOk(res: Response, action: string): Promise<void> {
  if (res.ok) return
  const text = await res.text().catch(() => ``)
  throw new Error(
    parseErrorResponse(text) ?? `${action} failed (${res.status})`
  )
}

function parseErrorResponse(text: string): string | null {
  if (!text) return null
  try {
    const data = JSON.parse(text) as {
      error?: { message?: unknown }
      message?: unknown
    }
    if (typeof data.error?.message === `string`) return data.error.message
    if (typeof data.message === `string`) return data.message
  } catch {
    return text
  }
  return text
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function roleLabel(role: ShareRole): string {
  return ROLE_BY_ID.get(role)?.label ?? role
}

function isAllUsersGrant(grant: EntityPermissionGrant): boolean {
  return (
    grant.subject_kind === ALL_USERS_SUBJECT_KIND &&
    grant.subject_value === ALL_USERS_SUBJECT_VALUE
  )
}
