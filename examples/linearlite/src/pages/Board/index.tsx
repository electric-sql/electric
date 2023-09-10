import TopFilter from '../../components/TopFilter'
import IssueBoard from './IssueBoard'
import { Issue, useElectric } from '../../electric'
import { useLiveQuery } from 'electric-sql/react'

function Board() {
  const { db } = useElectric()!
  const { results } = useLiveQuery(
    db.issue.liveMany({
      orderBy: {
        kanbanorder: 'asc',
      },
    })
  )
  const issues: Issue[] = results !== undefined ? [...results] : []

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopFilter title="Board" issues={issues} hideSort={true} />
      <IssueBoard issues={issues} />
    </div>
  )
}

export default Board
