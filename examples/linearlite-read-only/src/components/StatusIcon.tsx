import classNames from 'classnames'
import { StatusIcons } from '../types/types'

interface Props {
  status: string
  className?: string
}

export default function StatusIcon({ status, className }: Props) {
  const classes = classNames(`w-3.5 h-3.5 rounded`, className)

  const Icon = StatusIcons[status.toLowerCase()]

  return <Icon className={classes} />
}
