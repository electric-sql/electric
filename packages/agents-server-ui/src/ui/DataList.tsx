import type { CSSProperties, ReactNode } from 'react'
import styles from './DataList.module.css'

interface RootProps {
  size?: 1 | 2 | 3
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

interface ItemProps {
  label: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Two-column key/value list — replaces `<DataList>` from `@radix-ui/themes`.
 *
 * Implemented as a CSS grid since Base UI doesn't ship a direct
 * equivalent. `<DataList.Item label="...">value</DataList.Item>`.
 */
function Root({
  size = 1,
  className,
  style,
  children,
}: RootProps): React.ReactElement {
  const cls = [styles.root, styles[`size${size}`], className]
    .filter(Boolean)
    .join(` `)
  return (
    <dl className={cls} style={style}>
      {children}
    </dl>
  )
}

function Item({ label, children, className }: ItemProps): React.ReactElement {
  return (
    <>
      <dt className={[styles.label, className].filter(Boolean).join(` `)}>
        {label}
      </dt>
      <dd className={styles.value}>{children}</dd>
    </>
  )
}

export const DataList = { Root, Item }
