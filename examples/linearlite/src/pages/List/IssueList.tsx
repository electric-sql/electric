import IssueRow from './IssueRow'
import { Issue, useElectric } from '../../electric'

export interface IssueListProps {
  issues: Issue[]
}

function IssueList({ issues }: IssueListProps) {
  const { db } = useElectric()!

  // TODO: sync is not really working with large database. Manipulate the
  // size of the imported dataset in db/data.tsx

  // TODO: to understand if the bottleneck is the WASM sqlite, or sqlite
  // in general, may be good to try to run queries on the data with better-sqlite

  // TODO: would be nice to have client-provided query execution time.
  // we could use it as part of our debug console

  const handleIssueStatusChange = (issue: Issue, status: string) => {
    db.issue.update({
      data: {
        status: status,
      },
      where: {
        id: issue.id,
      },
    })
  }

  const handleIssuePriorityChange = (issue: Issue, priority: string) => {
    db.issue.update({
      data: {
        priority: priority,
      },
      where: {
        id: issue.id,
      },
    })
  }

  const issueRows = issues.map((issue) => (
    <IssueRow
      key={`issue-${issue.id}`}
      issue={issue}
      onChangePriority={handleIssuePriorityChange}
      onChangeStatus={handleIssueStatusChange}
    />
  ))

  return <div className="flex flex-col overflow-auto">{issueRows}</div>
}

export default IssueList
