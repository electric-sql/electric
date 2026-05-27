import { Switch as BaseSwitch } from '@base-ui/react/switch'
import styles from './Switch.module.css'

type SwitchProps = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  ariaLabel?: string
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  ariaLabel,
}: SwitchProps): React.ReactElement {
  return (
    <BaseSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={styles.root}
    >
      <BaseSwitch.Thumb className={styles.thumb} />
    </BaseSwitch.Root>
  )
}
