import TopFilter from '../../components/TopFilter'
import IssueBoard from './IssueBoard'
import { useFilterState } from '../../utils/filterState'
import { useShape } from '../../../../../react-hooks'
import { Issue } from '../../types/types'
import { baseUrl } from '../../electric'

function Board() {
  const [_filterState] = useFilterState()
  const issues = useShape({
    shape: { table: `issue` },
    baseUrl,
  })! as Issue[]

  // TODO: apply filter state

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopFilter title="Board" issues={issues} hideSort={true} />
      <IssueBoard issues={issues} />
    </div>
  )
}

export default Board
