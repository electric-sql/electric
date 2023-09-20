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
    const issuesByStatus: Record<string, Issue[]> = {};
    issues.forEach((issue) => {
      // If the issue has been moved, patch with new status and kanbanorder for sorting
      if (movedIssues[issue.id]) {
        issue = {
          ...issue,
          ...movedIssues[issue.id],
        };
      }
      const status = issue.status.toLowerCase();
      if (!issuesByStatus[status]) {
        issuesByStatus[status] = [];
      }
      issuesByStatus[status].push(issue);
    });

    // Sort issues in each column by kanbanorder and issue id
    Object.keys(issuesByStatus).forEach((status) => {
      issuesByStatus[status].sort((a, b) => {
        if (a.kanbanorder < b.kanbanorder) {
          return -1
        }
        if (a.kanbanorder > b.kanbanorder) {
          return 1
        }
        // Use unique issue id to break ties
        if (a.id < b.id) {
          return -1
        } else {
          return 1
        }
      })
    })

    return { issuesByStatus }
  }, [issues, movedIssues])

  const adjacentIssues = (
    column: string,
    index: number,
    sameColumn = true,
    currentIndex: number
  ) => {
    const columnIssues = issuesByStatus[column] || []
    let prevIssue: Issue | undefined
    let nextIssue: Issue | undefined
    if (sameColumn) {
      if (currentIndex < index) {
        prevIssue = columnIssues[index]
        nextIssue = columnIssues[index + 1]
      } else {
        prevIssue = columnIssues[index - 1]
        nextIssue = columnIssues[index]
      }
    } else {
      prevIssue = columnIssues[index - 1]
      nextIssue = columnIssues[index]
    }
    console.log('sameColumn', sameColumn)
    console.log('prevIssue', prevIssue)
    console.log('nextIssue', nextIssue)
    return { prevIssue, nextIssue }
  }

  /**
   * Fix duplicate kanbanorder, this is recursive so we can fix multiple consecutive
   * issues with the same kanbanorder.
   * @param issue The issue to fix the kanbanorder for
   * @param issueBefore The issue immediately before one that needs fixing
   * @returns The new kanbanorder that was set for the issue
   */
  const fixKanbanOrder = (issue: Issue, issueBefore: Issue) => {
    // First we find the issue immediately after the issue that needs fixing.
    const issueIndex = issuesByStatus[issue.status].indexOf(issue)
    const issueAfter = issuesByStatus[issue.status][issueIndex + 1]

    // The kanbanorder of the issue before the issue that needs fixing
    const prevKanbanOrder = issueBefore?.kanbanorder

    // The kanbanorder of the issue after the issue that needs fixing
    let nextKanbanOrder = issueAfter?.kanbanorder

    // If the next issue has the same kanbanorder the next issue needs fixing too,
    // we recursively call fixKanbanOrder for that issue to fix it's kanbanorder.
    if (issueAfter && nextKanbanOrder && nextKanbanOrder === prevKanbanOrder) {
      nextKanbanOrder = fixKanbanOrder(issueAfter, issueBefore)
    }

    // Generate a new kanbanorder between the previous and next issues
    const kanbanorder = generateKeyBetween(prevKanbanOrder, nextKanbanOrder)

    // Keep track of moved issues so we can override the kanbanorder when sorting
    // We do this due to the momentary lag between updating the database and the live
    // query updating the issues.
    setMovedIssues((prev) => ({
      ...prev,
      [issue.id]: {
        kanbanorder: kanbanorder,
      },
    }))

    // Update the issue in the database
    db.issue.update({
      data: {
        kanbanorder: kanbanorder,
      },
      where: {
        id: issue.id,
      },
    })

    // Return the new kanbanorder
    return kanbanorder
  }

  /**
   * Get a new kanbanorder that sits between two other issues.
   * Used to generate a new kanbanorder when moving an issue.
   * @param issueBefore The issue immediately before the issue being moved
   * @param issueAfter The issue immediately after the issue being moved
   * @returns The new kanbanorder
   */
  const getNewKanbanOrder = (issueBefore: Issue, issueAfter: Issue) => {
    const prevKanbanOrder = issueBefore?.kanbanorder
    let nextKanbanOrder = issueAfter?.kanbanorder
    if (nextKanbanOrder && nextKanbanOrder === prevKanbanOrder) {
      // If the next issue has the same kanbanorder as the previous issue,
      // we need to fix the kanbanorder of the next issue.
      // This can happen when two users move issues into the same position at the same
      // time.
      nextKanbanOrder = fixKanbanOrder(issueAfter, issueBefore)
    }
    return generateKeyBetween(prevKanbanOrder, nextKanbanOrder)
  }

  const onDragEnd = ({ source, destination, draggableId }: DropResult) => {
    console.log(source, destination, draggableId)
    if (destination && destination.droppableId) {
      const { prevIssue, nextIssue } = adjacentIssues(
        destination.droppableId,
        destination.index,
        destination.droppableId === source.droppableId,
        source.index
      )
      // Get a new kanbanorder between the previous and next issues
      const kanbanorder = getNewKanbanOrder(prevIssue, nextIssue)
      // Keep track of moved issues so we can override the status and kanbanorder when
      // sorting issues into columns.
      const modified = new Date().toISOString()
      setMovedIssues((prev) => ({
        ...prev,
        [draggableId]: {
          status: destination.droppableId,
          kanbanorder,
          modified,
        },
      }))
      // Update the issue in the database
      db.issue.update({
        data: {
          status: destination.droppableId,
          kanbanorder,
          modified,
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
