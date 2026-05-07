import { Badge } from '../ui'
import toolBlock from './toolBlock.module.css'
import type { BadgeTone } from '../ui'
import type { ReactElement, ReactNode } from 'react'

export function InlineStatusBadge({
  tone = `neutral`,
  className,
  children,
}: {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}): ReactElement {
  return (
    <Badge
      tone={tone}
      variant="soft"
      size={1}
      className={[toolBlock.statusBadge, className].filter(Boolean).join(` `)}
    >
      <span className={toolBlock.badgeDot} />
      {children}
    </Badge>
  )
}
