import { Portal } from '../Portal'
import React, { ReactNode, useRef, useState } from 'react'
import {
  ContextMenu,
  ContextMenuTrigger,
  MenuItem,
} from '@firefox-devtools/react-contextmenu'
import { Menu } from './menu'

import { ReactComponent as HighPriorityIcon } from '../../assets/icons/signal-strong.svg'
import { ReactComponent as LowPriorityIcon } from '../../assets/icons/signal-weak.svg'
import { ReactComponent as MediumPriorityIcon } from '../../assets/icons/signal-medium.svg'
import { ReactComponent as NoPriorityIcon } from '../../assets/icons/dots.svg'
import { ReactComponent as UrgentPriorityIcon } from '../../assets/icons/rounded-claim.svg'
import { Priority } from '../../types/issue'

interface Props {
  id: string
  button: ReactNode
  filterKeyword: boolean
  className?: string
  onSelect?: (item: string) => void
}

function PriorityMenu({
  id,
  button,
  filterKeyword,
  className,
  onSelect,
}: Props) {
  const [keyword, setKeyword] = useState('')

  const handleSelect = (priority: string) => {
    setKeyword('')
    if (onSelect) onSelect(priority)
  }
  let statusOpts = [
    [NoPriorityIcon, 'None', Priority.NONE],
    [UrgentPriorityIcon, 'Urgent', Priority.URGENT],
    [HighPriorityIcon, 'High', Priority.HIGH],
    [MediumPriorityIcon, 'Medium', Priority.MEDIUM],
    [LowPriorityIcon, 'Low', Priority.LOW],
  ]
  if (keyword !== '') {
    let normalizedKeyword = keyword.toLowerCase().trim()
    statusOpts = statusOpts.filter(
      ([Icon, label, priority]) =>
        (label as string).toLowerCase().indexOf(normalizedKeyword) !== -1
    )
  }

  const options = statusOpts.map(([Icon, label, priority], idx) => {
    return (
      <Menu.Item
        key={`priority-${idx}`}
        onClick={() => handleSelect(priority as string)}
      >
        <Icon className="mr-3" /> <span>{label}</span>
      </Menu.Item>
    )
  })

  return (
    <>
      <ContextMenuTrigger id={id} holdToDisplay={1}>
        {button}
      </ContextMenuTrigger>

      <Portal>
        <Menu
          id={id}
          size="small"
          filterKeyword={filterKeyword}
          searchPlaceholder="Set priority..."
          onKeywordChange={(kw) => setKeyword(kw)}
          className={className}
        >
          {options}
        </Menu>
      </Portal>
    </>
  )
}

PriorityMenu.defaultProps = {
  filterKeyword: false,
}

export default PriorityMenu
