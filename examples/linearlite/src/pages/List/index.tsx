import TopFilter from '../../components/TopFilter'
import { useState, createContext } from 'react'
import IssueList from './IssueList'
import { Issue, useElectric } from '../../electric'
import { useLiveQuery } from 'electric-sql/react'

export type Filter = {
  title: string
  // TODO: turn this into multicolumn-typed based on issue schema
  // TODO: make object for ordering or reuse this one
}

export type IssuesContext = {
  filter: Filter
  setFilter: (arg: Filter) => void
}

export const IssuesContext = createContext<IssuesContext>({
  filter: { title: '' },
  setFilter: () => undefined,
})

export interface ListProps {
  title?: string
}

function List({ title = 'All Issues' }: ListProps) {
  const { db } = useElectric()!
  const { results } = useLiveQuery(
    db.issue.liveMany({
      orderBy: { created: 'desc' },
    })
  )
  const issues: Issue[] = results !== undefined ? [...results] : []
  const [filter, setFilter] = useState<Filter>({
    title: '',
  })

  return (
    <IssuesContext.Provider value={{ filter: filter, setFilter: setFilter }}>
      <div className="flex flex-col flex-grow">
        <TopFilter title={title} issues={issues} />
        <IssueList issues={issues} />
      </div>
    </IssuesContext.Provider>
  )
}

export default List
