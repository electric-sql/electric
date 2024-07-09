import TopFilter from '../../components/TopFilter'
import IssueList from './IssueList'
import { useFilterState } from '../../utils/filterState'
import { useShape } from '../../../../../react-hooks'
import { baseUrl } from '../../electric'
import { Issue } from '../../types/types'

function List({ showSearch = false }) {
  const [_filterState] = useFilterState()

  const issues = useShape({
    shape: { table: `issue` },
    baseUrl,
  })! as Issue[]

  // TODO: apply filter state

  return (
    <div className="flex flex-col flex-grow">
      <TopFilter issues={issues} showSearch={showSearch} />
      <IssueList issues={issues} />
    </div>
  )
}

export default List
