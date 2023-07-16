import LeftMenu from '../../components/LeftMenu';
import TopFilter from '../../components/TopFilter';
import { useState, createContext } from 'react'
import IssueList from './IssueList'

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

function Home() {
  const [showMenu, setShowMenu] = useState(false);
  const [filter, setFilter] = useState<Filter>({
    title: '',
  })

  return (
    <IssuesContext.Provider value={{ filter: filter, setFilter: setFilter }}>
      <div className="flex w-full h-screen overflow-y-hidden">
        <LeftMenu showMenu={showMenu} onCloseMenu={() => setShowMenu(false)} />
        <div className="flex flex-col flex-grow">
          <TopFilter
            onOpenMenu={() => setShowMenu(!showMenu)}
            title="All issues"
          />
          <IssueList />
        </div>
      </div>
    </IssuesContext.Provider>
  )
}

export default Home;
