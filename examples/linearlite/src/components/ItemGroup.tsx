import {
  BsFillCaretDownFill,
  BsFillCaretRightFill,
  BsCloudArrowDownFill,
} from 'react-icons/bs'
import * as React from 'react'
import { useState } from 'react'

interface Props {
  title: string
  onSync?: () => void
  children: React.ReactNode
}
function ItemGroup({ title, children, onSync }: Props) {
  const [showItems, setShowItems] = useState(true)

  const Icon = showItems ? BsFillCaretDownFill : BsFillCaretRightFill
  return (
    <div className="flex flex-col w-full text-sm">
      <div className="flex flex-row">
        <button
          className="px-2 relative w-full mt-0.5 h-7 flex items-center rounded hover:bg-gray-100 cursor-pointer truncate"
          onClick={() => setShowItems(!showItems)}
        >
          <Icon className="w-3 min-w-3 h-3 mr-2 -ml-1" />
          <div className="truncate">{title}</div>
        </button>
        {onSync && (
          <button
            className="px-2 relative min-w-10 w-10 mt-0.5 h-7 flex items-center rounded hover:bg-gray-100 cursor-pointer justify-center"
            onClick={onSync}
          >
            <BsCloudArrowDownFill />
          </button>
        )}
      </div>
      {showItems && children}
    </div>
  )
}

export default ItemGroup
