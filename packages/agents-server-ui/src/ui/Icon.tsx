import styles from './Icon.module.css'
import type { LucideIcon } from 'lucide-react'

export type IconSize = 1 | 2 | 3 | 4

type IconProps = Omit<React.ComponentProps<LucideIcon>, `size`> & {
  icon: LucideIcon
  size?: IconSize
}

export function Icon({
  icon: Component,
  size = 2,
  className,
  'aria-hidden': ariaHidden = true,
  ...props
}: IconProps): React.ReactElement {
  const cls = [styles.icon, styles[`size${size}`], className]
    .filter(Boolean)
    .join(` `)
  return <Component className={cls} aria-hidden={ariaHidden} {...props} />
}
