import { Select as BaseSelect } from '@base-ui/react/select'
import { Check, ChevronDown } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import popoverStyles from './Popover.module.css'
import styles from './Select.module.css'

export type SelectSize = `md` | `pill`

interface RootProps<V extends string> {
  value?: V | null
  defaultValue?: V | null
  /**
   * Called when the selected value changes. Receives `null` when the user
   * picks an item whose value is `null` (i.e. when the select is acting
   * as a clearable input).
   */
  onValueChange?: (value: V | null) => void
  disabled?: boolean
  /** Submitted form name + value (when used inside a `<form>`). */
  name?: string
  /** Render the trigger as part of an HTML form. */
  required?: boolean
  children?: ReactNode
}

interface TriggerProps {
  placeholder?: ReactNode
  size?: SelectSize
  className?: string
  style?: CSSProperties
  autoFocus?: boolean
  /**
   * Optional aria-label, useful for compact triggers (e.g. pill) where
   * there is no visible Field label.
   */
  [`aria-label`]?: string
  /** Tooltip-style hint shown on hover. */
  title?: string
}

interface ContentProps {
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

interface ItemProps<V extends string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, `children`> {
  value: V
  children: ReactNode
}

function Root<V extends string>({
  value,
  defaultValue,
  onValueChange,
  disabled,
  name,
  required,
  children,
}: RootProps<V>): React.ReactElement {
  return (
    <BaseSelect.Root
      value={value as string | null | undefined}
      defaultValue={defaultValue as string | null | undefined}
      onValueChange={
        onValueChange
          ? (v: string | null) => onValueChange(v as V | null)
          : undefined
      }
      disabled={disabled}
      name={name}
      required={required}
    >
      {children}
    </BaseSelect.Root>
  )
}

function Trigger({
  placeholder,
  size = `md`,
  className,
  style,
  autoFocus,
  [`aria-label`]: ariaLabel,
  title,
}: TriggerProps): React.ReactElement {
  const cls = [size === `pill` ? styles.triggerPill : styles.trigger, className]
    .filter(Boolean)
    .join(` `)
  const iconSize = size === `pill` ? 12 : 14
  return (
    <BaseSelect.Trigger
      className={cls}
      style={style}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      title={title}
    >
      <BaseSelect.Value placeholder={placeholder} />
      <BaseSelect.Icon className={styles.icon}>
        <ChevronDown size={iconSize} />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  )
}

function Content({
  className,
  style,
  children,
}: ContentProps): React.ReactElement {
  const cls = [popoverStyles.popup, styles.popup, className]
    .filter(Boolean)
    .join(` `)
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner sideOffset={6}>
        <BaseSelect.Popup className={cls} style={style}>
          <BaseSelect.List className={styles.list}>{children}</BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  )
}

function Item<V extends string>({
  value,
  children,
  className,
  ...rest
}: ItemProps<V>): React.ReactElement {
  const cls = [styles.item, className].filter(Boolean).join(` `)
  return (
    <BaseSelect.Item value={value} className={cls} {...rest}>
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
      <BaseSelect.ItemIndicator className={styles.indicator}>
        <Check size={14} />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  )
}

/**
 * Native-style select — wraps `@base-ui/react/select`.
 *
 * Replaces `Select.Root / Trigger / Content / Item` from
 * `@radix-ui/themes` with the same shape:
 *
 *   <Select.Root value={v} onValueChange={setV}>
 *     <Select.Trigger placeholder="Pick one" />
 *     <Select.Content>
 *       <Select.Item value="a">A</Select.Item>
 *     </Select.Content>
 *   </Select.Root>
 */
export const Select = { Root, Trigger, Content, Item }
