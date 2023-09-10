import StatusIcon from '../../components/StatusIcon'
import { memo } from 'react'
import { Droppable, DroppableProvided } from 'react-beautiful-dnd'
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

  console.log(`Render IssueCol: ${title}, count: ${issueItems.length}`)

  return (
    <Droppable droppableId={status} key={status} type="category">
      {(provided: DroppableProvided) => {
        console.log(
          `Render DroppableProvided: ${title}, count: ${issueItems.length}`
        )
        return (
          <div className="flex flex-col flex-shrink-0 mr-3 select-none w-90">
            <div className="flex items-center justify-between pb-3 text-sm">
              <div className="flex items-center">
                {statusIcon}
                <span className="ml-3 mr-3 font-medium">{title} </span>
                <span className="mr-3 font-normal text-gray-400">
                  {issues?.length || 0}
                </span>
              </div>
            </div>

            <div
              className="flex flex-col flex-1 w-full overflow-y-auto border-gray-200 pt-0.5"
              ref={provided.innerRef}
              {...provided.droppableProps}
            >
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
