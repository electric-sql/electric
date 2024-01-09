import TopFilter from '../../components/TopFilter'
import IssueBoard from './IssueBoard'
import { Issue, useElectric } from '../../electric'
import { useLiveQuery } from 'electric-sql/react'
import { useFilterState, filterStateToWhere } from '../../utils/filterState'

function Board() {
  const [filterState] = useFilterState()
  const { db } = useElectric()!
  const { results } = useLiveQuery(
    db.issue.liveMany({
      select: {
        id: true,
        title: true,
        priority: true,
        status: true,
        modified: true,
        created: true,
        kanbanorder: true,
        username: true,
      },
      orderBy: {
        kanbanorder: 'asc',
      },
      where: filterStateToWhere(filterState),
    })
  )
  const issues: Issue[] = results ?? []

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopFilter title="Board" issues={issues} hideSort={true} />
      <IssueBoard issues={issues} />
    </div>
  )
}

export default Board
