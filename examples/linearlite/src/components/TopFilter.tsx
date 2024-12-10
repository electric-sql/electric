import { ReactComponent as MenuIcon } from '../assets/icons/menu.svg'
import { useState, useContext, useEffect } from 'react'
import { BsSortUp, BsPlus, BsX, BsSearch as SearchIcon } from 'react-icons/bs'
import { useLiveQuery, usePGlite } from '@electric-sql/pglite-react'
import ViewOptionMenu from './ViewOptionMenu'
import { MenuContext } from '../App'
import FilterMenu from './contextmenu/FilterMenu'
import { FilterState, useFilterState } from '../utils/filterState'
import { PriorityDisplay, StatusDisplay } from '../types/types'
import debounce from 'lodash.debounce'
import { createFTSIndex } from '../migrations'

interface Props {
  filteredIssuesCount: number
  hideSort?: boolean
  showSearch?: boolean
  title?: string
  filterState?: FilterState
}

export default function ({
  filteredIssuesCount,
  hideSort,
  showSearch,
  title = `All issues`,
  filterState,
}: Props) {
  const [usedFilterState, setFilterState] = useFilterState()
  const [showViewOption, setShowViewOption] = useState(false)
  const { showMenu, setShowMenu } = useContext(MenuContext)!
  const [searchQuery, setSearchQuery] = useState(``)
  const [FTSIndexReady, setFTSIndexReady] = useState(true)
  const pg = usePGlite()

  filterState ??= usedFilterState

  const totalIssuesCount = useLiveQuery<{ count: number }>(
    `SELECT COUNT(id) FROM issue WHERE deleted = false`
  )?.rows[0].count

  const handleSearchInner = debounce((query: string) => {
    setFilterState({
      ...filterState,
      query: query,
    })
  }, 300)

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    handleSearchInner(query)
  }

  const eqStatuses = (statuses: string[]) => {
    const statusSet = new Set(statuses)
    return (
      filterState.status?.length === statusSet.size &&
      filterState.status.every((x) => statusSet.has(x))
    )
  }

  if (filterState.status?.length) {
    if (eqStatuses([`backlog`])) {
      title = `Backlog`
    } else if (eqStatuses([`todo`, `in_progress`])) {
      title = `Active`
    }
  }

  useEffect(() => {
    if (!showSearch) return
    const checkFTSIndex = async () => {
      const res = await pg.query(
        `SELECT 1 FROM pg_indexes WHERE indexname = 'issue_search_idx';`
      )
      const indexReady = res.rows.length > 0
      if (!indexReady) {
        setFTSIndexReady(false)
        await createFTSIndex(pg)
      }
      setFTSIndexReady(true)
    }
    checkFTSIndex()
  }, [showSearch, pg])

  const showFTSIndexProgress = showSearch && !FTSIndexReady

  return (
    <>
      <div className="flex justify-between flex-shrink-0 pl-2 pr-6 border-b border-gray-200 h-14 lg:pl-9">
        {/* left section */}
        <div className="flex items-center">
          <button
            type="button"
            className="flex-shrink-0 h-full px-5 lg:hidden"
            onClick={() => setShowMenu(!showMenu)}
          >
            <MenuIcon className="w-3.5 text-gray-500 hover:text-gray-800" />
          </button>

          <div className="p-1 font-semibold me-1">{title}</div>
          {/* <span>{filteredIssuesCount}</span> */}
          <span>
            {filteredIssuesCount.toLocaleString()}
            {totalIssuesCount !== undefined &&
            filteredIssuesCount !== totalIssuesCount
              ? ` of ${totalIssuesCount.toLocaleString()}`
              : ``}
          </span>
          <FilterMenu
            button={
              <button
                type="button"
                className="px-1 py-0.5 ml-3 border border-gray-300 border-dashed rounded text-gray-500 hover:border-gray-400 hover:text-gray-800 flex items-center"
              >
                <BsPlus className="inline" size="16" />
                Filter
              </button>
            }
            id={`filter-menu`}
          />
        </div>

        <div className="flex items-center">
          {!hideSort && (
            <button
              type="button"
              className="p-2 rounded hover:bg-gray-100"
              onClick={() => setShowViewOption(true)}
            >
              <BsSortUp size="16" className="inline" />
            </button>
          )}
        </div>
      </div>

      {(!!filterState.status?.length || !!filterState.priority?.length) && (
        <div className="flex flex-shrink-0 pl-2 pr-6 border-b border-gray-200 lg:pl-9 py-2">
          {!!filterState.priority?.length && (
            <div className="flex pr-4 space-x-[1px]">
              <span className="px-1 bg-gray-300 rounded-l">Priority is</span>
              <span className="px-1 bg-gray-300 ">
                {filterState.priority
                  ?.map(
                    (priority) =>
                      PriorityDisplay[priority as keyof typeof PriorityDisplay]
                  )
                  .join(`, `)}
              </span>
              <span
                className="px-1 bg-gray-300 rounded-r cursor-pointer flex items-center"
                onClick={() => {
                  setFilterState({
                    ...filterState,
                    priority: undefined,
                  })
                }}
              >
                <BsX size={16} />
              </span>
            </div>
          )}
          {!!filterState.status?.length && (
            <div className="flex pr-4 space-x-[1px]">
              <span className="px-1 bg-gray-300 rounded-l">Status is</span>
              <span className="px-1 bg-gray-300 ">
                {filterState.status
                  ?.map(
                    (status) =>
                      StatusDisplay[status as keyof typeof StatusDisplay]
                  )
                  .join(`, `)}
              </span>
              <span
                className="px-1 bg-gray-300 rounded-r cursor-pointer flex items-center"
                onClick={() => {
                  setFilterState({
                    ...filterState,
                    status: undefined,
                  })
                }}
              >
                <BsX size={16} />
              </span>
            </div>
          )}
        </div>
      )}

      {showSearch && (
        <div className="flex items-center justify-between flex-shrink-0 pl-2 pr-6 border-b border-gray-200 lg:pl-9 py-2">
          <SearchIcon className="w-3.5 h-3.5 ms-3 absolute" />
          <input
            type="search"
            className="w-full bg-gray-100 border-0 rounded px-2 py-1.5 ps-9"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
      )}

      {showFTSIndexProgress && (
        <div className="flex items-center justify-between flex-shrink-0 pl-2 pr-6 border-b border-gray-200 lg:pl-9 py-2">
          <div className="flex items-center gap-2">
            <div className="animate-spin h-4 w-4 border-2 border-gray-500 rounded-full border-t-transparent"></div>
            <span>Building full text search index... (only happens once)</span>
          </div>
        </div>
      )}

      <ViewOptionMenu
        isOpen={showViewOption}
        onDismiss={() => setShowViewOption(false)}
      />
    </>
  )
}
