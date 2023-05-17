import LeftMenu from '../../components/LeftMenu';
import TopFilter from '../../components/TopFilter';
import { useState } from 'react';
import IssueBoard from './IssueBoard';

function Board() {
  const [showMenu, setShowMenu] = useState(false);
  return (
    <div className="flex w-screen h-screen overflow-y-hidden">
      <LeftMenu showMenu={showMenu} onCloseMenu={() => setShowMenu(false)} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopFilter
          onOpenMenu={() => setShowMenu(!showMenu)}
          title="All issues"
        />
        <IssueBoard />
      </div>
    </div>
  );
}

export default Board;
