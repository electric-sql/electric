import React, { useContext, useEffect } from "react";
import { connectMenu } from "@firefox-devtools/react-contextmenu";
import IssueContextMenu from "./IssueContextMenu";
import IssueRow from "./IssueRow";
import { Issue, useElectric } from "../../electric";
import { IssuesContext } from ".";
import { useLiveQuery } from "electric-sql/react";

const ConnectedMenu = connectMenu("ISSUE_CONTEXT_MENU")(IssueContextMenu);

function IssueList() {
  const { filter }: IssuesContext = useContext(IssuesContext);

  const { db } = useElectric()!;

  useEffect(() => void db.issue.sync(), []);

  // TODO: i think we need a way to reuse a live query across components

  // TODO: sync is not really working with large database. Manipulate the
  // size of the imported dataset in db/data.tsx

  // TODO: to understand if the bottleneck is the WASM sqlite, or sqlite
  // in general, may be good to try to run queries on the data with better-sqlite

  // TODO: would be nice to have client-provided query execution time.
  // we could use it as part of our debug console

  console.log(filter.title);

  const { results } = useLiveQuery(
    db.issue.liveMany({
      where: {
        title: {
          // TODO: not working
          contains: filter?.title ?? "",
        },
      },
      orderBy: { created: "desc" },
    })
  );

  const issues = results !== undefined ? [...results] : [];

  const handleIssueStatusChange = (issue: Issue, status: string) => {
    db.issue.update({
      data: {
        status: status,
      },
      where: {
        id: issue.id,
      },
    });
  };

  const handleIssuePriorityChange = (issue: Issue, priority: string) => {
    db.issue.update({
      data: {
        priority: priority,
      },
      where: {
        id: issue.id,
      },
    });
  };

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
      {issueRows}
      <ConnectedMenu />
    </div>
  );
}

export default IssueList;
