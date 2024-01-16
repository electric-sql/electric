import { useEffect, useRef, useState } from "react";
import TopFilter from "../../components/TopFilter";
import IssueList from "./IssueList";
import { Issue, useElectric } from "../../electric";
import { useLiveQuery } from "electric-sql/react";
import { useFilterState, filterStateToWhere } from "../../utils/filterState";
import { embedIssue } from "../../utils/vectorSearch";

function List({ showSearch = false }) {
  const [filterState] = useFilterState();
  const { db } = useElectric()!;

  const useVectorSearch =
    filterState.searchType === "vector" && filterState.query;

  const liveQuery = db.issue.liveMany({
    select: {
      id: true,
      title: true,
      priority: true,
      status: true,
      modified: true,
      created: true,
      kanbanorder: true,
      username: true,
    },
    ...(filterState.searchType !== "vector"
      ? {
          orderBy: { [filterState.orderBy]: filterState.orderDirection },
        }
      : {}),
    where: filterStateToWhere(filterState),
  });

  const [vectorResults, setVectorResult] = useState<Issue[]>([]);

  const filterStateHash = JSON.stringify(filterState);

  const timeoutId = useRef<number | null>(null);
  const vectorSearchThrottle = 1000;

  useEffect(() => {
    let ignore = false;

    const getResults = async () => {
      if (useVectorSearch) {
        const embedding = await embedIssue(filterState.query ?? "");
        if (ignore) return;

        let { text: sql, values } = db.issue._builder
          .findMany(liveQuery.sourceQuery as any)
          .toParam();
        sql = sql.replace(" id,", " issue.id AS id,");
        sql = sql.replace(
          " FROM issue",
          ` FROM issue INNER JOIN document ON document.issue_id = issue.id `
        );
        sql += ` ORDER BY document.embeddings <=> '${embedding}'`;
        sql += ` LIMIT 100;`;

        const results = await db.raw({ sql, args: values });
        if (ignore) return;

        setVectorResult(results as Issue[]);
      }
    };

    if (useVectorSearch) {
      if (timeoutId.current) {
        clearTimeout(timeoutId.current);
      }
      timeoutId.current = setTimeout(getResults, vectorSearchThrottle) as any;
    }

    return () => {
      ignore = true;
    };
  }, [filterStateHash]);

  const { results: liveResults } = useLiveQuery(() => {
    if (useVectorSearch) {
      return db.liveRaw({ sql: "" }); // empty live query
    }
    return liveQuery;
  }, [filterStateHash]);

  const issues: Issue[] = useVectorSearch
    ? vectorResults ?? []
    : (liveResults as Issue[]) ?? [];

  return (
    <div className="flex flex-col flex-grow">
      <TopFilter issues={issues} showSearch={showSearch} />
      <IssueList issues={issues} />
    </div>
  );
}

export default List;
