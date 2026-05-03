import { Separator as BaseSeparator } from '@base-ui/react/separator'
import type { CSSProperties } from 'react'
import styles from './Separator.module.css'

interface SeparatorProps {
  orientation?: `horizontal` | `vertical`
  className?: string
  style?: CSSProperties
}

/**
 * Visual / semantic separator. Wraps `@base-ui/react/separator` so the
 * accessibility role + orientation are handled correctly.
 */
export function Separator({
  orientation = `horizontal`,
  className,
  style,
}: SeparatorProps): React.ReactElement {
  const cls = [styles.separator, styles[orientation], className]
    .filter(Boolean)
    .join(` `)
  return (
    <BaseSeparator orientation={orientation} className={cls} style={style} />
  )
}
