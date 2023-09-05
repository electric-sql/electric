import StatusIcon from '../../components/StatusIcon'
import { memo } from 'react'
import { Droppable, DroppableProvided } from 'react-beautiful-dnd'
import { BsThreeDots as MoreIcon } from 'react-icons/bs'
import { GoPlus as AddIcon } from 'react-icons/go'
import { Issue } from '../../electric'
import IssueItem from './IssueItem'

interface Props {
  status: string
  title: string
  issues: Array<Issue> | undefined
}

function IssueCol({ title, status, issues }: Props) {
  const statusIcon = <StatusIcon status={status} />
  const issueItems = (issues || []).map((issue, idx) => (
    <IssueItem key={issue.id} issue={issue} index={idx} />
  ))

  return (
    <Droppable droppableId={status} key={status} type="category">
      {(provided: DroppableProvided) => {
        return (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className="flex flex-col flex-shrink-0 mr-3 select-none w-90"
          >
            {/* column title */}
            <div className="flex items-center justify-between pb-3 text-sm">
              {/* left info */}
              <div className="flex items-center">
                {statusIcon}
                <span className="ml-3 mr-3 font-medium">{title} </span>
                <span className="mr-3 font-normal text-gray-400">
                  {issues?.length || 0}
                </span>
              </div>

              {/* action buttons */}
              <div className="flex items-center">
                <button className="flex items-center justify-center border-none rounded h-7 w-7 hover:bg-gray-200 focus:outline-none">
                  <AddIcon className="w-3.5 text-gray-400 hover:text-gray-700" />
                </button>
                <button className="flex items-center justify-center border-none rounded h-7 w-7 hover:bg-gray-200 focus:outline-none">
                  <MoreIcon className="w-3.5 text-gray-400 hover:text-gray-700" />
                </button>
              </div>
            </div>

            {/* list of issues */}
            <div className="flex flex-col flex-1 w-full overflow-y-auto border-gray-200 pt-0.5">
              {issueItems}
              {provided.placeholder}
            </div>
          </div>
        )
      }}
    </Droppable>
  )
}

export default memo(IssueCol)
