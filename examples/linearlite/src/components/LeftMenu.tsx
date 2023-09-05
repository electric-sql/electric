import { ReactComponent as AddIcon } from '../assets/icons/add.svg';
import { ReactComponent as ArchiveIcon } from '../assets/icons/archive.svg';
import { ReactComponent as HelpIcon } from '../assets/icons/help.svg';
import { ReactComponent as InboxIcon } from '../assets/icons/inbox.svg';
import { ReactComponent as IssueIcon } from '../assets/icons/issue.svg';
import { ReactComponent as MenuIcon } from '../assets/icons/menu.svg';
import { ReactComponent as ProjectIcon } from '../assets/icons/project.svg';
import { ReactComponent as ViewIcon } from '../assets/icons/view.svg';
import classnames from 'classnames';
import SearchBox from '../components/SearchBox';
import { useClickOutside } from '../hooks/useClickOutside';
import React, {memo, ReactComponentElement, RefObject, useEffect, useRef, useState} from 'react';
import { FiCircle } from 'react-icons/fi';
import { MdKeyboardArrowDown as ExpandMore } from 'react-icons/md';
import { Link } from 'react-router-dom';
import Avatar from './Avatar';
import HelpModal from './HelpModal';
import InviteBox from './InviteBox';
import IssueModal from './IssueModal';
import ItemGroup from './ItemGroup';
import ProfileMenu from './ProfileMenu';

interface Props {
  // Show menu (for small screen only)
  showMenu: boolean;
  onCloseMenu?: () => void;
  onCreateIssue?: Function;
  onOpenHelp?: Function;
  onOpenInviteBox?: Function;
}
function LeftMenu({ showMenu, onCloseMenu }: Props) {
  const ref = useRef<HTMLDivElement>() as RefObject<HTMLDivElement>;
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);

  let classes = classnames(
    'absolute lg:static inset-0 transform duration-300 lg:relative lg:translate-x-0 bg-white flex flex-col flex-shrink-0 w-56 font-sans text-sm text-gray-700 border-r border-gray-100 lg:shadow-none justify-items-start',
    {
      '-translate-x-full ease-out shadow-none': !showMenu,
      'translate-x-0 ease-in shadow-xl': showMenu,
    }
  );

  useClickOutside(ref, () => {
    if (showMenu && onCloseMenu) onCloseMenu();
  });

  return (
    <>
      <div className={classes} ref={ref}>
        <button
          className="flex-shrink-0 px-5 ml-2 lg:hidden h-14 focus:outline-none"
          onClick={onCloseMenu}
        >
          <MenuIcon className="w-3.5 text-gray-500 hover:text-gray-800" />
        </button>

        {/* Top menu*/}
        <div className="flex flex-col flex-grow-0 flex-shrink-0 px-5 py-3">
          <div className="flex items-center justify-between">
            {/* Project selection */}
            <div className="flex items-center p-2 pr-3 rounded cursor-pointer hover:bg-gray-100">
              <div className="flex text-sm items-center justify-center rounded-sm w-4.5 h-4.5 text-white bg-yellow-500 mr-2.5">
                G
              </div>
              <div className="text-sm font-medium">github</div>
            </div>

            {/* User avatar  */}
            <div className="relative">
              <div
                className="flex items-center justify-center p-2 rounded cursor-pointer hover:bg-gray-100"
                onClick={() => setShowProfileMenu(!showProfileMenu)}
              >
                <Avatar name="Electric" online={true} />
                <ExpandMore size={13} className="ml-2" />
              </div>
              <ProfileMenu
                isOpen={showProfileMenu}
                onDismiss={() => setShowProfileMenu(false)}
                className="absolute top-10"
              />
            </div>
          </div>

          {/* Create issue btn */}
          <button
            className="inline-flex items-center px-2 py-2 mt-3 bg-white border border-gray-300 rounded hover:bg-gray-100 focus:outline-none h-7"
            onClick={() => {
              setShowIssueModal(true)
            }}
          >
            <AddIcon className="mr-2.5 w-3.5 h-3.5" /> New Issue
          </button>
        </div>

        {/* Search box */}
        <div className="flex flex-col flex-shrink flex-grow overflow-y-auto mb-0.5 px-4">
          <SearchBox className="mt-5" />
          {/* actions */}
          <Link
            to="/"
            className="group relative w-full mt-0.5 py-2 px-2 h-7 flex items-center rounded hover:bg-gray-100 cursor-pointer"
          >
            <InboxIcon className="w-3.5 h-3.5 mr-4 text-sm text-gray-500 group-hover:text-gray-600" />
            <span>Inbox</span>
          </Link>
          <Link
            to="/"
            className="group relative w-full mt-0.5 py-2 px-2 h-7 flex items-center rounded hover:bg-gray-100 cursor-pointer"
          >
            <IssueIcon className="w-3.5 h-3.5 mr-4 text-gray-500 group-hover:text-gray-600" />
            <span>Issues</span>
          </Link>
          <Link
            to="/"
            className="group relative w-full mt-0.5 py-2 px-2 h-7 flex items-center rounded hover:bg-gray-100 cursor-pointer"
          >
            <ViewIcon className="w-3.5 h-3.5 mr-4 text-gray-500 group-hover:text-gray-600" />
            <span>Views</span>
          </Link>

          {/* Teams */}
          <h3 className="px-2 mt-5 text-xs text-gray-500">Your teams</h3>

          <ItemGroup title="Github">
            <Link
              to="/"
              className="flex items-center pl-8 rounded cursor-pointer group h-7 hover:bg-gray-100"
            >
              <FiCircle className="w-3.5 h-3.5 mr-2 text-gray-500 group-hover:text-gray-600" />
              <span>Issues</span>
            </Link>
            <Link
              to="/"
              className="flex items-center pl-8 rounded cursor-pointer h-7 hover:bg-gray-100"
            >
              <span className="w-3 h-3 mr-2"></span>
              <span>Backlog</span>
            </Link>
            <Link
              to="/"
              className="flex items-center pl-8 rounded cursor-pointer h-7 hover:bg-gray-100"
            >
              <span className="w-3 h-3 mr-2"></span>
              <span>All</span>
            </Link>
            <Link
              to="/board"
              className="flex items-center pl-8 rounded cursor-pointer h-7 hover:bg-gray-100"
            >
              <span className="w-3 h-3 mr-2"></span>
              <span>Board</span>
            </Link>
            <Link
              to="/"
              className="flex items-center pl-8 rounded cursor-pointer group h-7 hover:bg-gray-100"
            >
              <ProjectIcon className="w-3 h-3 mr-2 text-gray-500 group-hover:text-gray-700" />
              <span>Projects</span>
            </Link>
            <Link
              to="/"
              className="flex items-center pl-8 rounded cursor-pointer group h-7 hover:bg-gray-100"
            >
              <ArchiveIcon className="w-3 h-3 mr-2 text-gray-500 group-hover:text-gray-700" />
              <span>Archives</span>
            </Link>
          </ItemGroup>

          {/* extra space */}
          <div className="flex flex-col flex-grow flex-shrink" />

          {/* bottom group */}
          <div className="px-2 pb-2 text-gray-500 mt-7">
            <button
              className="inline-flex focus:outline-none"
              onClick={() => setShowInviteModal(true)}
            >
              <AddIcon className="w-3 mr-2" /> Invite people
            </button>
            <button
              className="inline-flex mt-1 focus:outline-none"
              onClick={() => setShowHelpModal(true)}
            >
              <HelpIcon className="w-3 mr-2" /> Help & Feedback
            </button>
          </div>
        </div>
      </div>
      {/* Modals */}
      {
        <HelpModal
          isOpen={showHelpModal}
          onDismiss={() => setShowHelpModal(false)}
        />
      }
      {
        <InviteBox
          isOpen={showInviteModal}
          onDismiss={() => setShowInviteModal(false)}
        />
      }
      {
        <IssueModal
          isOpen={showIssueModal}
          onDismiss={() => setShowIssueModal(false)}
        />
      }
    </>
  )
}

export default memo(LeftMenu);
