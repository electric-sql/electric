import { Select as BaseSelect } from '@base-ui/react/select'
import { ChevronDown } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import popoverStyles from './Popover.module.css'
import styles from './Select.module.css'

interface RootProps<V extends string> {
  value?: V | null
  defaultValue?: V | null
  onValueChange?: (value: V) => void
  disabled?: boolean
  children?: ReactNode
}

interface TriggerProps {
  placeholder?: ReactNode
  className?: string
  style?: CSSProperties
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
  children,
}: RootProps<V>): React.ReactElement {
  return (
    <BaseSelect.Root
      value={value as string | null | undefined}
      defaultValue={defaultValue as string | null | undefined}
      onValueChange={
        onValueChange
          ? (v: string | null) => {
              if (v !== null) onValueChange(v as V)
            }
          : undefined
      }
      disabled={disabled}
    >
      {children}
    </BaseSelect.Root>
  )
}

function Trigger({
  placeholder,
  className,
  style,
}: TriggerProps): React.ReactElement {
  const cls = [styles.trigger, className].filter(Boolean).join(` `)
  return (
    <BaseSelect.Trigger className={cls} style={style}>
      <BaseSelect.Value placeholder={placeholder} />
      <BaseSelect.Icon className={styles.icon}>
        <ChevronDown size={14} />
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
