import { PreviewCard as BasePreviewCard } from '@base-ui/react/preview-card'
import { useRef, type CSSProperties, type ReactNode } from 'react'
import popoverStyles from './Popover.module.css'

type Handle<Payload> = ReturnType<typeof BasePreviewCard.createHandle<Payload>>

interface RootProps<Payload = unknown> {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * Optional handle (created with `HoverCard.createHandle()`) that
   * lets a single `<Root>` serve many detached `<Trigger>`s. Use this
   * to share open-state — and the active-trigger's payload — across
   * an arbitrary list of items so the popup follows the pointer
   * without re-incurring the open delay.
   */
  handle?: Handle<Payload>
  /**
   * Either a regular React node, or a render function that receives
   * `{ payload }` from the currently-active trigger when used with a
   * shared handle. The render function fires on every payload change
   * so the popup body re-renders as the pointer moves between
   * triggers.
   */
  children?: ReactNode | ((args: { payload: Payload | undefined }) => ReactNode)
}

type Side = `top` | `right` | `bottom` | `left`
type Align = `start` | `center` | `end`

interface ContentProps {
  side?: Side
  align?: Align
  sideOffset?: number
  className?: string
  style?: CSSProperties
  children?: ReactNode
  padded?: boolean
}

interface TriggerProps<Payload = unknown> {
  handle?: Handle<Payload>
  payload?: Payload
  /**
   * Override the open delay (ms) for this trigger. Defaults to the
   * Base UI default (600ms). Once any trigger sharing the same handle
   * is open, hovering another switches the popup over immediately —
   * the per-trigger `delay` only governs the *initial* open.
   */
  delay?: number
  closeDelay?: number
  render?: ReactNode | ((props: object, state: object) => ReactNode)
  className?: string
  children?: ReactNode
}

/**
 * Hover-card primitive — wraps `@base-ui/react/preview-card`.
 *
 * Two usage modes:
 *
 *   1. Standalone — one `<Root>` per trigger (legacy ergonomic API):
 *
 *        <HoverCard.Root>
 *          <HoverCard.Trigger render={…} />
 *          <HoverCard.Content>…</HoverCard.Content>
 *        </HoverCard.Root>
 *
 *   2. Shared handle — single `<Root>` for many `<Trigger>`s, with
 *      per-trigger payload feeding a render-function child. Once one
 *      trigger has opened the card, moving the pointer to a sibling
 *      trigger swaps the popup contents immediately (no re-delay):
 *
 *        const handle = HoverCard.useHandle<MyPayload>()
 *        <HoverCard.Root handle={handle}>
 *          {({ payload }) => (
 *            <HoverCard.Content>{payload && <Info {...payload} />}</HoverCard.Content>
 *          )}
 *        </HoverCard.Root>
 *        // …and elsewhere, for each item:
 *        <HoverCard.Trigger handle={handle} payload={…} render={…} />
 *
 * Use for read-only preview content (e.g. sidebar info popout, FK row
 * preview in the state table).
 */
function Root<Payload>({
  open,
  defaultOpen,
  onOpenChange,
  handle,
  children,
}: RootProps<Payload>): React.ReactElement {
  return (
    <BasePreviewCard.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      handle={handle}
    >
      {children as React.ReactNode}
    </BasePreviewCard.Root>
  )
}

function Content({
  side = `bottom`,
  align = `center`,
  sideOffset = 6,
  className,
  style,
  padded = true,
  children,
}: ContentProps): React.ReactElement {
  const cls = [
    popoverStyles.popup,
    padded ? popoverStyles.padding : null,
    className,
  ]
    .filter(Boolean)
    .join(` `)
  return (
    <BasePreviewCard.Portal>
      <BasePreviewCard.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
      >
        <BasePreviewCard.Popup className={cls} style={style}>
          {children}
        </BasePreviewCard.Popup>
      </BasePreviewCard.Positioner>
    </BasePreviewCard.Portal>
  )
}

function Trigger<Payload>(props: TriggerProps<Payload>): React.ReactElement {
  return <BasePreviewCard.Trigger {...(props as object)} />
}

/**
 * Memoize a single handle for the lifetime of the consumer component.
 * Use one handle per group of related triggers (e.g. all rows in a
 * sidebar list). Implemented as a lazy ref so the handle is created
 * exactly once and we don't need to involve React's deps-array linting.
 */
function useHandle<Payload = unknown>(): Handle<Payload> {
  const ref = useRef<Handle<Payload> | null>(null)
  if (ref.current === null) {
    ref.current = BasePreviewCard.createHandle<Payload>()
  }
  return ref.current
}

export const HoverCard = {
  Root,
  Trigger,
  Content,
  createHandle: BasePreviewCard.createHandle,
  useHandle,
}
