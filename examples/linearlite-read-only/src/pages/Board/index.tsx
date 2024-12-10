// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import TopFilter from '../../components/TopFilter'
import IssueBoard from './IssueBoard'
import { useFilterState } from '../../utils/filterState'
import { useShape } from '@electric-sql/react'
import { Issue } from '../../types/types'
import { issueShape } from '../../shapes'

function Board() {
  const [_filterState] = useFilterState()
  const { data: issues } = useShape<Issue>(issueShape)!

  // TODO: apply filter state

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopFilter title="Board" issues={issues} hideSort={true} />
      <IssueBoard issues={issues} />
    </div>
  )
}

export default Board
