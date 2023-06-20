import LeftMenu from '../../components/LeftMenu';
import TopFilter from '../../components/TopFilter';
import { useState } from 'react';
import IssueList from './IssueList';

function Home() {
  const [showMenu, setShowMenu] = useState(false);
  return (
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
  );
}

export default Home;
