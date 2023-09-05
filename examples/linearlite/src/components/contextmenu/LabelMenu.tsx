import { Portal } from '../Portal'
import React, { ReactNode, useState } from 'react'
import { ContextMenuTrigger } from '@firefox-devtools/react-contextmenu'
import { DEFAULT_LABLES, Label } from '../../types/issue'
import { Menu } from './menu'

interface Props {
  id: string
  button: ReactNode
  className?: string
  onSelect?: (item: any) => void
}
const Labels = []

export default function LabelMenu({ id, button, className, onSelect }: Props) {
  const [keyword, setKeyword] = useState('')
  const handleSelect = (label: Label) => {
    if (onSelect) onSelect(label)
  }

  let labels = DEFAULT_LABLES
  if (keyword !== '') {
    let normalizedKeyword = keyword.toLowerCase().trim()
    labels = labels.filter((l) =>
      l.name.toLowerCase().includes(normalizedKeyword)
    )
  }

  let options = labels.map((label) => (
    <Menu.Item key={label.id} onClick={() => handleSelect(label)}>
      {/* <input type='check' className='w-3.5 h-3.5 mr-3' /> */}
      <div
        className="w-2.5 h-2.5 rounded-full mr-3"
        style={{ background: label.color }}
      ></div>
      <div className="flex-1 overflow-hidden">{label.name}</div>
    </Menu.Item>
  ))

  return (
    <>
      <ContextMenuTrigger id={id} holdToDisplay={1}>
        {button}
      </ContextMenuTrigger>

      <Portal>
        <Menu
          id={id}
          size="normal"
          filterKeyword={true}
          className={className}
          searchPlaceholder="Change labels..."
          onKeywordChange={(kw) => setKeyword(kw)}
        >
          {options}
        </Menu>
      </Portal>
    </>
  )
}
