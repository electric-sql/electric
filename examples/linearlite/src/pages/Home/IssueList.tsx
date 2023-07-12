import React, { useEffect } from 'react';
import { connectMenu } from 'react-contextmenu';
import { useDispatch, useSelector } from 'react-redux';
// import { AppDispatch, RootState } from 'store';
// import {
//   loadIssues,
//   updateIssuePriority,
//   updateIssueStatus,
// } from 'store/actions/issueActions';
// import { Issue } from 'types/issue';
import IssueContextMenu from './IssueContextMenu';
import IssueRow from './IssueRow';
import {useElectric} from "../../electric";
import {useLiveQuery} from "electric-sql/react";

const ConnectedMenu = connectMenu('ISSUE_CONTEXT_MENU')(IssueContextMenu);

function IssueList() {
    const { db } = useElectric()!
    const { results } = useLiveQuery(db.issue.liveMany({}))

    const issues = results !== undefined ? [...results] : []

  // TODO
  // const dispatch = useDispatch<AppDispatch>();
  // const allIssues = useSelector((state: RootState) => state.issues);

  // let issues = [
  //   ...allIssues.backlog,
  //   ...allIssues.todo,
  //   ...allIssues.inProgress,
  //   ...allIssues.done,
  //   ...allIssues.canceled,
  // ];
  // // sort issues by id
  // issues = issues.sort((a, b) => {
  //   let aId = parseInt(a.id.split('-')[1]);
  //   let bId = parseInt(b.id.split('-')[1]);
  //   return aId - bId;
  // });


    const handleIssueStatusChange = (issue: Issue, status: string) => {
        db.issue.update({
            data: {
                status: status
            },
            where: {
                id: issue.id
            }
        })
    };

    const handleIssuePriorityChange = (issue: Issue, priority: string) => {
        db.issue.update({
            data: {
                priority: priority
            },
            where: {
                id: issue.id
            }
        })
    };

  //
  // useEffect(() => {
  //   dispatch(loadIssues());
  // }, []);

    var issueRows = issues.map((issue) => (
      <IssueRow
        key={`issue-${issue.id}`}
        issue={issue}
        onChangePriority={handleIssuePriorityChange}
        onChangeStatus={handleIssueStatusChange}
      />
    ));

  return (
    <div className="flex flex-col overflow-auto">
      { issueRows }
      <ConnectedMenu />
    </div>
  );
}

export default IssueList;
