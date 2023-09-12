import classNames from 'classnames'
import { PriorityIcons } from '../types/issue'

interface Props {
  priority: string
  className?: string
}

export default function PriorityIcon({ priority, className }: Props) {
  const classes = classNames('w-3.5 h-3.5', className)
  const Icon = PriorityIcons[priority.toLowerCase()]
  return <Icon className={classes} />
}
