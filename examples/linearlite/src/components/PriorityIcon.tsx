import SignalUrgentIcon from '../assets/icons/claim.svg';
import SignalNoPriorityIcon from '../assets/icons/dots.svg';
import SignalMediumIcon from '../assets/icons/signal-medium.svg';
import SignalStrongIcon from '../assets/icons/signal-strong.svg';
import SignalWeakIcon from '../assets/icons/signal-weak.svg';
import classNames from 'classnames';
import React from 'react';
import { Priority } from '../types/issue';

interface Props {
  priority: string;
  className?: string;
}

const ICONS = {
  [Priority.HIGH]: SignalStrongIcon,
  [Priority.MEDIUM]: SignalMediumIcon,
  [Priority.LOW]: SignalWeakIcon,
  [Priority.URGENT]: SignalUrgentIcon,
  [Priority.NONE]: SignalNoPriorityIcon,
}

export default function PriorityIcon({ priority, className }: Props) {
  let classes = classNames('w-3.5 h-3.5 rounded', className)

  let Icon = ICONS[priority.toLowerCase()]

  return <Icon className={classes} />
}
