import React from 'react'
import { DragDropContext, DropResult } from 'react-beautiful-dnd'
import { Status } from '../../types/issue'
import IssueCol from './IssueCol'
import { Issue, useElectric } from '../../electric'
import { useLiveQuery } from 'electric-sql/react'

export default function IssueBoard() {
  const { db } = useElectric()!
  const { results } = useLiveQuery(db.issue.liveMany({}))

  const issues: Issue[] = results !== undefined ? [...results] : []

  const onDragEnd = ({ /*source,*/ destination, draggableId }: DropResult) => {
    db.issue.update({
      data: {
        status: destination?.droppableId,
      },
      where: {
        id: draggableId,
      },
    })
  }

  // TODO: in the way I implemented this, we wait for tue update notification
  // to como through change notification to refresh the page... and is not fast enough
  // will we end maintaining a copy of the app state for quick ui events, and mask
  // db exec time? find the bottleneck
  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex flex-1 pt-6 pl-8 overflow-scroll bg-gray-100">
        <IssueCol
          title={'Backlog'}
          status={Status.BACKLOG}
          issues={issues.filter(
            (i) => i.status.toLowerCase() === Status.BACKLOG,
          )}
        />
        <IssueCol
          title={'Todo'}
          status={Status.TODO}
          issues={issues.filter((i) => i.status.toLowerCase() === Status.TODO)}
        />
        <IssueCol
          title={'In Progress'}
          status={Status.IN_PROGRESS}
          issues={issues.filter(
            (i) => i.status.toLowerCase() == Status.IN_PROGRESS,
          )}
        />
        <IssueCol
          title={'Done'}
          status={Status.DONE}
          issues={issues.filter((i) => i.status.toLowerCase() === Status.DONE)}
        />
        <IssueCol
          title={'Canceled'}
          status={Status.CANCELED}
          issues={issues.filter(
            (i) => i.status.toLowerCase() === Status.CANCELED,
          )}
        />
      </div>
    </DragDropContext>
  )
}
