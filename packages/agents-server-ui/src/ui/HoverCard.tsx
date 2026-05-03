import { PreviewCard as BasePreviewCard } from '@base-ui/react/preview-card'
import type { CSSProperties, ReactNode } from 'react'
import popoverStyles from './Popover.module.css'

interface RootProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
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

/**
 * Hover-card primitive — wraps `@base-ui/react/preview-card`.
 *
 * Replaces `@radix-ui/themes` `<HoverCard>`. Opens on pointer hover or
 * keyboard focus, closes shortly after the pointer leaves both trigger
 * and popup. Use for read-only preview content (e.g. FK row preview in
 * the state table).
 */
function Root({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: RootProps): React.ReactElement {
  return (
    <BasePreviewCard.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
    >
      {children}
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

export const HoverCard = {
  Root,
  Trigger: BasePreviewCard.Trigger,
  Content,
}
