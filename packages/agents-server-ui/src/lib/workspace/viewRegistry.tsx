import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { ElectricEntity } from '../ElectricAgentsProvider'

/**
 * `ViewId` is a free-form string rather than a string-literal union so the
 * registry stays the single source of truth — adding a new view is a
 * `registerView({ id: 'logs', … })` call, not a type edit. Type-safety is
 * enforced at the registration site instead, and `getView(id)` returns
 * `undefined` for unknown ids so callers must explicitly handle the missing
 * case.
 */
export type ViewId = string

/**
 * Props an *entity* view receives. The `tileId` is included so views can scope
 * local state (scroll position, selected row, etc.) per-tile rather than
 * per-entity, matching VS Code's behaviour where two splits of the same file
 * scroll independently.
 */
export type EntityViewProps = {
  baseUrl: string
  entityUrl: string
  entity: ElectricEntity
  entityStopped: boolean
  isSpawning: boolean
  tileId: string
}

/**
 * Props a *standalone* view receives. No entity bound to the tile —
 * just a baseUrl (for any server-relative API calls) and the tile id.
 */
export type StandaloneViewProps = {
  baseUrl: string
  tileId: string
}

/** Discriminated union — `kind` distinguishes which props shape applies. */
export type ViewProps = EntityViewProps

export type EntityViewDefinition = {
  kind: `entity`
  id: ViewId
  /** Human label shown in the menu and on the inline view-strip. */
  label: string
  icon: LucideIcon
  shortLabel?: string
  description?: string
  /**
   * Per-entity availability gate. Used to hide views that don't apply to
   * this entity type (e.g. a Coding-session-only timeline view). When
   * omitted the view is considered available for every entity.
   */
  isAvailable?: (entity: ElectricEntity) => boolean
  Component: ComponentType<EntityViewProps>
}

export type StandaloneViewDefinition = {
  kind: `standalone`
  id: ViewId
  label: string
  icon: LucideIcon
  shortLabel?: string
  description?: string
  Component: ComponentType<StandaloneViewProps>
}

export type ViewDefinition = EntityViewDefinition | StandaloneViewDefinition

const registry = new Map<ViewId, ViewDefinition>()

export function registerView(def: ViewDefinition): void {
  registry.set(def.id, def)
}

export function getView(id: ViewId): ViewDefinition | undefined {
  return registry.get(id)
}

/**
 * List registered views.
 *
 * - `listViews(entity)`     entity views available for that entity, in
 *                           registration order. Standalone views are
 *                           excluded — they don't belong in an entity
 *                           tile's view-switcher.
 * - `listViews()`           every entity view (for entity-less callers
 *                           like the Workspace bootstrap that just need
 *                           a default view id).
 * - `listStandaloneViews()` standalone views (currently just
 *                           "new-session"); used to render their tile
 *                           chrome / placeholder UI.
 */
export function listViews(
  entity?: ElectricEntity
): Array<EntityViewDefinition> {
  const entityViews = Array.from(registry.values()).filter(
    (v): v is EntityViewDefinition => v.kind === `entity`
  )
  return entity
    ? entityViews.filter((v) => v.isAvailable?.(entity) ?? true)
    : entityViews
}

export function listStandaloneViews(): Array<StandaloneViewDefinition> {
  return Array.from(registry.values()).filter(
    (v): v is StandaloneViewDefinition => v.kind === `standalone`
  )
}

/**
 * Test-only escape hatch — clears the registry between Vitest suites so
 * registrations from one test don't bleed into the next. Production code
 * should never call this.
 */
export function __resetViewRegistryForTesting(): void {
  registry.clear()
}
