import classNames from 'classnames'
import Avatar from '../../components/Avatar'
import PriorityMenu from '../../components/contextmenu/PriorityMenu'
import PriorityIcon from '../../components/PriorityIcon'
import React, { memo } from 'react'
import {
  Draggable,
  DraggableProvided,
  DraggableStateSnapshot,
} from 'react-beautiful-dnd'
// import { updateIssuePriority } from 'store/actions/issueActions';
import { Issue } from '../../electric'

interface IssueProps {
  issue: Issue
  index: number
}

const IssueItem = ({ issue, index }: IssueProps) => {
  let priorityIcon = (
    <span className="inline-block m-0.5 rounded-sm border border-gray-100 hover:border-gray-200 p-0.5">
      <PriorityIcon priority={issue.priority} />
    </span>
  )

  // const dispatch = useDispatch<AppDispatch>();
  const updatePriority = (priority: string) => {
    // dispatch(updateIssuePriority(issue, priority));
  }

  return (
    <Draggable draggableId={issue.id || 'id'} index={index} key={issue.id}>
      {(provided: DraggableProvided, snapshot: DraggableStateSnapshot) => {
        let isDragging = snapshot.isDragging && !snapshot.isDropAnimating
        return (
          <div
            ref={provided.innerRef}
            className={classNames(
              'cursor-default flex flex-col w-full px-4 py-3 mb-2 bg-white rounded focus:outline-none',
              {
                'shadow-modal': isDragging,
              }
            )}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
          >
            <div className="flex justify-between w-full cursor-default">
              <div className="flex flex-col">
                <span className="text-xs font-normal text-gray-500 uppercase">
                  {issue.id}
                </span>
                <span className="mt-1 text-sm font-medium text-gray-700 line-clamp-2 overflow-ellipsis">
                  {issue.title}
                </span>
              </div>
              <div className="flex-shrink-0">
                <Avatar name={issue.username} />
                {/* {issue.owner ? (
                  <Avatar
                    name={issue.owner.name}
                    avatarUrl={issue.owner.avatar}
                  />
                ) : (
                  <Avatar name={issue.username} />
                )} */}
              </div>
            </div>
            <div className="mt-2.5 flex items-center">
              <PriorityMenu
                button={priorityIcon}
                id={'priority-menu-' + issue.id}
                filterKeyword={true}
                onSelect={(p) => updatePriority(p)}
              />
            </div>
          </div>
        )
      }}
    </Draggable>
  )
}

export default memo(IssueItem)
