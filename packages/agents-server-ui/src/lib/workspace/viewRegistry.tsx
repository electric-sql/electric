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
 * Props every view receives. The `tileId` is included so views can scope
 * local state (scroll position, selected row, etc.) per-tile rather than
 * per-entity, matching VS Code's behaviour where two splits of the same file
 * scroll independently.
 */
export type ViewProps = {
  baseUrl: string
  entityUrl: string
  entity: ElectricEntity
  entityStopped: boolean
  isSpawning: boolean
  tileId: string
}

export type ViewDefinition = {
  id: ViewId
  /** Human label shown in the View ▸ submenu and on tabs. */
  label: string
  /** Tab/menu icon. */
  icon: LucideIcon
  /** Optional shorter label for narrow tabs (defaults to `label`). */
  shortLabel?: string
  /** Optional helper text rendered as a hint in the View ▸ menu. */
  description?: string
  /**
   * Per-entity availability gate. Used to hide views that don't apply to
   * this entity type (e.g. a Coding-session-only timeline view). When
   * omitted the view is considered available for every entity.
   */
  isAvailable?: (entity: ElectricEntity) => boolean
  /**
   * Default split direction when the user clicks the parent `View ▸ X`
   * menu row directly (rather than picking a sub-action). `'right'` matches
   * the muscle-memory of "drawer pops out to the right" for the State
   * Explorer; `undefined` falls back to `'open here'`.
   */
  defaultSplit?: `right` | `down`
  Component: ComponentType<ViewProps>
}

const registry = new Map<ViewId, ViewDefinition>()

export function registerView(def: ViewDefinition): void {
  registry.set(def.id, def)
}

export function getView(id: ViewId): ViewDefinition | undefined {
  return registry.get(id)
}

/**
 * List every registered view, optionally filtered by per-entity availability.
 * Stable order = insertion order, matching `Map`'s iteration semantics, so
 * registration order in `registerViews.ts` controls the menu ordering.
 */
export function listViews(entity?: ElectricEntity): Array<ViewDefinition> {
  const all = Array.from(registry.values())
  return entity ? all.filter((v) => v.isAvailable?.(entity) ?? true) : all
}

/**
 * Test-only escape hatch — clears the registry between Vitest suites so
 * registrations from one test don't bleed into the next. Production code
 * should never call this.
 */
export function __resetViewRegistryForTesting(): void {
  registry.clear()
}
