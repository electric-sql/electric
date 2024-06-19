import type React from 'react'

import CancelIcon from '../assets/icons/cancel.svg?react'
import BacklogIcon from '../assets/icons/circle-dot.svg?react'
import TodoIcon from '../assets/icons/circle.svg?react'
import DoneIcon from '../assets/icons/done.svg?react'
import InProgressIcon from '../assets/icons/half-circle.svg?react'

import HighPriorityIcon from '../assets/icons/signal-strong.svg?react'
import LowPriorityIcon from '../assets/icons/signal-weak.svg?react'
import MediumPriorityIcon from '../assets/icons/signal-medium.svg?react'
import NoPriorityIcon from '../assets/icons/dots.svg?react'
import UrgentPriorityIcon from '../assets/icons/rounded-claim.svg?react'

export const Priority = {
  NONE: 'none',
  URGENT: 'urgent',
  HIGH: 'high',
  LOW: 'low',
  MEDIUM: 'medium',
}

export const PriorityDisplay = {
  [Priority.NONE]: 'None',
  [Priority.URGENT]: 'Urgent',
  [Priority.HIGH]: 'High',
  [Priority.LOW]: 'Low',
  [Priority.MEDIUM]: 'Medium',
}

export const PriorityIcons = {
  [Priority.NONE]: NoPriorityIcon,
  [Priority.URGENT]: UrgentPriorityIcon,
  [Priority.HIGH]: HighPriorityIcon,
  [Priority.MEDIUM]: MediumPriorityIcon,
  [Priority.LOW]: LowPriorityIcon,
}

export const PriorityOptions: [
  React.FunctionComponent<React.SVGProps<SVGSVGElement>>,
  string,
  (typeof Priority)[keyof typeof Priority]
][] = [
  [PriorityIcons[Priority.NONE], Priority.NONE, 'None'],
  [PriorityIcons[Priority.URGENT], Priority.URGENT, 'Urgent'],
  [PriorityIcons[Priority.HIGH], Priority.HIGH, 'High'],
  [PriorityIcons[Priority.MEDIUM], Priority.MEDIUM, 'Medium'],
  [PriorityIcons[Priority.LOW], Priority.LOW, 'Low'],
]

export const Status = {
  BACKLOG: 'backlog',
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
  CANCELED: 'canceled',
}

export const StatusDisplay = {
  [Status.BACKLOG]: 'Backlog',
  [Status.TODO]: 'To Do',
  [Status.IN_PROGRESS]: 'In Progress',
  [Status.DONE]: 'Done',
  [Status.CANCELED]: 'Canceled',
}

export const StatusIcons = {
  [Status.BACKLOG]: BacklogIcon,
  [Status.TODO]: TodoIcon,
  [Status.IN_PROGRESS]: InProgressIcon,
  [Status.DONE]: DoneIcon,
  [Status.CANCELED]: CancelIcon,
}

export const StatusOptions: [
  React.FunctionComponent<React.SVGProps<SVGSVGElement>>,
  (typeof Status)[keyof typeof Status],
  string
][] = [
  [StatusIcons[Status.BACKLOG], Status.BACKLOG, StatusDisplay[Status.BACKLOG]],
  [StatusIcons[Status.TODO], Status.TODO, StatusDisplay[Status.TODO]],
  [
    StatusIcons[Status.IN_PROGRESS],
    Status.IN_PROGRESS,
    StatusDisplay[Status.IN_PROGRESS],
  ],
  [StatusIcons[Status.DONE], Status.DONE, StatusDisplay[Status.DONE]],
  [
    StatusIcons[Status.CANCELED],
    Status.CANCELED,
    StatusDisplay[Status.CANCELED],
  ],
]
