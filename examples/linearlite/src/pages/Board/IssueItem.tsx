import classNames from 'classnames'
import { useNavigate } from 'react-router-dom'
import Avatar from '../../components/Avatar'
import PriorityMenu from '../../components/contextmenu/PriorityMenu'
import PriorityIcon from '../../components/PriorityIcon'
import { memo } from 'react'
import {
  Draggable,
  DraggableProvided,
  DraggableStateSnapshot,
} from 'react-beautiful-dnd'
import { Issue, useElectric } from '../../electric'

interface IssueProps {
  issue: Issue
  index: number
}

const IssueItem = ({ issue, index }: IssueProps) => {
  const { db } = useElectric()!
  const navigate = useNavigate()
  const priorityIcon = (
    <span className="inline-block m-0.5 rounded-sm border border-gray-100 hover:border-gray-200 p-0.5">
      <PriorityIcon priority={issue.priority} />
    </span>
  )

  const updatePriority = (priority: string) => {
    db.issue.update({
      data: {
        priority: priority,
        modified: new Date().toISOString(),
      },
      where: {
        id: issue.id,
      },
    })
  }

  return (
    <Draggable draggableId={issue.id || 'id'} index={index} key={issue.id}>
      {(provided: DraggableProvided, snapshot: DraggableStateSnapshot) => {
        const isDragging = snapshot.isDragging && !snapshot.isDropAnimating
        return (
          <div
            ref={provided.innerRef}
            className={classNames(
              'cursor-default flex flex-col w-full px-4 py-3 mb-2 bg-white rounded focus:outline-none',
              {
                'shadow-modal': isDragging,
              }
            )}
            onClick={() => navigate(`/issue/${issue.id}`)}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
          >
            <div className="flex justify-between w-full cursor-default">
              <div className="flex flex-col">
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
