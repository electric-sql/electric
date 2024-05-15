import { BsFillCaretDownFill, BsFillCaretRightFill } from 'react-icons/bs'
import * as React from 'react'
import { useState } from 'react'
import ProjectSyncToggle from './ProjectSyncToggle'

interface Props {
  title: string
  projectId?: string
  children: React.ReactNode
}
function ItemGroup({ title, children, projectId }: Props) {
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
        {projectId && (
          <div className="px-2 relative min-w-10 w-10 mt-0.5 h-7">
            <ProjectSyncToggle projectId={projectId} />
          </div>
        )}
      </div>
      {showItems && children}
    </div>
  )
}

export default ItemGroup
