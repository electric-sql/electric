import TopFilter from '../../components/TopFilter'
import IssueBoard from './IssueBoard'
import { Issue, useElectric } from '../../electric'
import { useLiveQuery } from 'electric-sql/react'
import { useParams } from 'react-router-dom'
import { useFilterState, filterStateToWhere } from '../../utils/filterState'

function Board() {
  const [filterState] = useFilterState()
  const { id } = useParams()
  const { db } = useElectric()!
  const { results } = useLiveQuery(
    db.issue.liveMany({
      orderBy: {
        kanbanorder: 'asc',
      },
      where: {
        ...filterStateToWhere(filterState),
        project_id: id,
      },
    })
  )
  const { results: project } = useLiveQuery(
    db.project.liveUnique({
      where: { id: id },
    })
  )
  const issues: Issue[] = results ?? []

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopFilter issues={issues} hideSort={true} title={project ? `${project?.name} : Board` : 'Board'} />
      <IssueBoard issues={issues} />
    </div>
  )
}

export default Board
