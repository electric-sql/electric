import { ReactComponent as MenuIcon } from '../assets/icons/menu.svg'
import { useState, useContext } from 'react'
import { BiSortUp } from 'react-icons/bi'
import IssueFilterModal from './IssueFilterModal'
import ViewOptionMenu from './ViewOptionMenu'
import { Issue } from '../electric'
import { MenuContext } from '../App'

interface Props {
  title: string
  issues: Issue[]
  hideSort?: boolean
}

export default function ({ title, issues, hideSort }: Props) {
  const [showFilter, setShowFilter] = useState(false)
  const [showViewOption, setShowViewOption] = useState(false)
  const { showMenu, setShowMenu } = useContext(MenuContext)!

  const totalIssues = issues.length

  return (
    <>
      <div className="flex justify-between flex-shrink-0 pl-2 pr-6 border-b border-gray-200 h-14 lg:pl-9">
        {/* left section */}
        <div className="flex items-center">
          <button
            className="flex-shrink-0 h-full px-5 lg:hidden"
            onClick={() => setShowMenu(!showMenu)}
          >
            <MenuIcon className="w-3.5 text-gray-500 hover:text-gray-800" />
          </button>

          <div className="p-1 font-semibold me-1">{title}</div>
          <span>{totalIssues}</span>
          <button
            className="px-1 py-0.5 ml-3 border border-gray-300 border-dashed rounded text-gray-500 hover:border-gray-400 hover:text-gray-800"
            onClick={() => setShowFilter(!showFilter)}
          >
            + Filter
          </button>
        </div>

        <div className="flex items-center">
          {!hideSort && (
            <button
              className="p-2 rounded hover:bg-gray-100"
              onClick={() => setShowViewOption(true)}
            >
              <BiSortUp size={14} />
            </button>
          )}
        </div>
      </div>
      <ViewOptionMenu
        isOpen={showViewOption}
        onDismiss={() => setShowViewOption(false)}
      />
      <IssueFilterModal
        isOpen={showFilter}
        onDismiss={() => setShowFilter(false)}
      />
    </>
  )
}
