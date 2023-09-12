import TopFilter from '../../components/TopFilter'
import IssueList from './IssueList'
import { Issue, useElectric } from '../../electric'
import { useLiveQuery } from 'electric-sql/react'
import { useFilterState, filterStateToWhere } from '../../utils/filterState'

export interface ListProps {
  title?: string
}

function List({ title = 'All Issues' }: ListProps) {
  const [filterState] = useFilterState()
  const { db } = useElectric()!
  const { results } = useLiveQuery(
    db.issue.liveMany({
      orderBy: { [filterState.orderBy]: filterState.orderDirection },
      where: filterStateToWhere(filterState),
    })
  )
  const issues: Issue[] = results !== undefined ? [...results] : []

  return (
    <div className="flex flex-col flex-grow">
      <TopFilter title={title} issues={issues} />
      <IssueList issues={issues} />
    </div>
  )
}

export default List
