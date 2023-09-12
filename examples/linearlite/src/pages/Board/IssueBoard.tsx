import { DragDropContext, DropResult } from 'react-beautiful-dnd'
import { useMemo, useState, useEffect } from 'react'
import { generateKeyBetween } from 'fractional-indexing'
import { Issue, useElectric } from '../../electric'
import { Status, StatusDisplay } from '../../types/issue'
import IssueCol from './IssueCol'

export interface IssueBoardProps {
  issues: Issue[]
}

interface MovedIssues {
  [id: string]: {
    status?: string
    kanbanorder?: string
  }
}

export default function IssueBoard({ issues }: IssueBoardProps) {
  const { db } = useElectric()!
  const [movedIssues, setMovedIssues] = useState<MovedIssues>({})

  // Issues are coming from a live query, this may not have updated before we rerender
  // after a drag and drop. So we keep track of moved issues and use that to override
  // the status of the issue when sorting the issues into columns.

  useEffect(() => {
    // Reset moved issues when issues change
    setMovedIssues({})
  }, [issues])

  const { issuesByStatus } = useMemo(() => {
    // Sort issues into columns by status
    const issuesByStatus = issues.reduce((acc, issue) => {
      // If the issue has been moved, patch with new status and kanbanorder for sorting
      if (movedIssues[issue.id]) {
        issue = {
          ...issue,
          ...movedIssues[issue.id],
        }
      }
      const status = issue.status.toLowerCase()
      if (!acc[issue.status]) {
        acc[issue.status] = []
      }
      acc[status].push(issue)
      return acc
    }, {} as Record<string, Issue[]>)

    // Sort issues in each column by kanbanorder
    Object.keys(issuesByStatus).forEach((status) => {
      issuesByStatus[status].sort((a, b) => {
        if (a.kanbanorder < b.kanbanorder) {
          return -1
        }
        if (a.kanbanorder > b.kanbanorder) {
          return 1
        }
        return 0
      })
    })

    return { issuesByStatus }
  }, [issues, movedIssues])

  const adjacentIssues = (
    thisIssueId: string,
    column: string,
    index: number
  ) => {
    let columnIssues = issuesByStatus[column] || []
    columnIssues = columnIssues.filter((issue) => issue.id !== thisIssueId)
    const prevIssue = columnIssues[index - 1]
    const nextIssue = columnIssues[index]
    return { prevIssue, nextIssue }
  }

  const fixKanbanOrder = (issue: Issue, issueBefore: Issue) => {
    // Fix duplicate kanbanorder, this is recursive so we can fix multiple issues
    // with the same kanbanorder.
    let issueSeen = false
    const issueAfter = issuesByStatus[issue.status].find((i) => {
      if (issueSeen) {
        return i.kanbanorder >= issue.kanbanorder
      } else {
        issueSeen = issue.id === i.id
        return false
      }
    })
    const prevKanbanOrder = issueBefore?.kanbanorder
    let nextKanbanOrder = issueAfter?.kanbanorder
    if (issueAfter && nextKanbanOrder && nextKanbanOrder === prevKanbanOrder) {
      nextKanbanOrder = fixKanbanOrder(issueAfter, issueBefore)
    }
    const kanbanorder = generateKeyBetween(prevKanbanOrder, nextKanbanOrder)
    setMovedIssues((prev) => ({
      ...prev,
      [issue.id]: {
        kanbanorder: kanbanorder,
      },
    }))
    db.issue.update({
      data: {
        kanbanorder: kanbanorder,
      },
      where: {
        id: issue.id,
      },
    })
    return kanbanorder
  }

  const getKanbanOrder = (issueBefore: Issue, issueAfter: Issue) => {
    const prevKanbanOrder = issueBefore?.kanbanorder
    let nextKanbanOrder = issueAfter?.kanbanorder
    if (nextKanbanOrder && nextKanbanOrder === prevKanbanOrder) {
      // If the next issue has the same kanbanorder as the previous issue,
      // we need to fix the kanbanorder of the next issue.
      nextKanbanOrder = fixKanbanOrder(issueAfter, issueBefore)
    }
    return generateKeyBetween(prevKanbanOrder, nextKanbanOrder)
  }

  const onDragEnd = ({ /*source,*/ destination, draggableId }: DropResult) => {
    if (destination && destination.droppableId) {
      const { prevIssue, nextIssue } = adjacentIssues(
        draggableId,
        destination.droppableId,
        destination.index
      )
      const kanbanorder = getKanbanOrder(prevIssue, nextIssue)
      // Keep track of moved issues so we can override the status when sorting
      setMovedIssues((prev) => ({
        ...prev,
        [draggableId]: {
          status: destination.droppableId,
          kanbanorder: kanbanorder,
        },
      }))
      db.issue.update({
        data: {
          status: destination.droppableId,
          kanbanorder: kanbanorder,
        },
        where: {
          id: draggableId,
        },
      })
    }
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex flex-1 pt-6 pl-8 overflow-scroll bg-gray-100">
        <IssueCol
          title={StatusDisplay[Status.BACKLOG]}
          status={Status.BACKLOG}
          issues={issuesByStatus[Status.BACKLOG]}
        />
        <IssueCol
          title={StatusDisplay[Status.TODO]}
          status={Status.TODO}
          issues={issuesByStatus[Status.TODO]}
        />
        <IssueCol
          title={StatusDisplay[Status.IN_PROGRESS]}
          status={Status.IN_PROGRESS}
          issues={issuesByStatus[Status.IN_PROGRESS]}
        />
        <IssueCol
          title={StatusDisplay[Status.DONE]}
          status={Status.DONE}
          issues={issuesByStatus[Status.DONE]}
        />
        <IssueCol
          title={StatusDisplay[Status.CANCELED]}
          status={Status.CANCELED}
          issues={issuesByStatus[Status.CANCELED]}
        />
      </div>
    </DragDropContext>
  )
}
