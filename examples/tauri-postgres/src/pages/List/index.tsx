import { useEffect, useState } from 'react'
import TopFilter from '../../components/TopFilter'
import IssueList from './IssueList'
import { Issue, useElectric } from '../../electric'
import { useLiveQuery } from 'electric-sql/react'
import { useFilterState, filterStateToWhere } from '../../utils/filterState'
import { embedIssue, chat } from './VectorSearch'

function List({ showSearch = false }) {
  let new_issues: Issue[] = []

  const [searchType, setSearchType] = useState('basicSearch')
  const [vectorResult, setVectorResult] = useState(new_issues)
  const [chatResult, setChatResult] = useState("Waiting...")

  useEffect(() => {
    let new_issues: Issue[] = []

    // declare the data fetching function
    const fetchData = async () => {
      const embedding = await embedIssue(filterState.query ?? "");
      let results = await
        db.raw({
          sql: `SELECT issue.id, title, priority, status, modified, created, kanbanorder, username FROM issue INNER JOIN document ON document.issue_id = issue.id ORDER BY document.embeddings <=> '${embedding}';`
        })
      for (const result of results) {
        new_issues.push(result as Issue);
      }
      console.log(new_issues);
      setVectorResult(new_issues);
      switch(searchType) {
        case 'chat':
          let response = await chat(filterState.query ?? "I forgot to add a question, say cheese", new_issues[0].description);
          setChatResult(response);
          break;
      }
  }

    // call the function
    fetchData()
      // make sure to catch any error
      .catch(console.error);
  }, [searchType])

  const [filterState] = useFilterState()
  const { db } = useElectric()!
  const { results } = useLiveQuery(
    db.issue.liveMany({
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
      orderBy: { [filterState.orderBy]: filterState.orderDirection },
      where: filterStateToWhere(filterState),
    })
  )
  const getResults = () => {
    let finalResults: Issue[] =[];
    switch(searchType) {
      case 'basicSearch':
        finalResults = results ?? [];
        break;
      case 'vectorSearch':
          //TODO - call
        console.log('vector search', searchType)
        console.log(filterState.query)

        finalResults = vectorResult ?? []
        break;
      case 'chat':
        //TODO
        console.log('chat', searchType)

        finalResults = vectorResult ?? []
        console.log(filterState.query)
        break;

      default:
        finalResults = [];
    }

    return finalResults;
  }

  const issues: Issue[] = getResults() ?? []

  return (
    <div className="flex flex-col flex-grow">
      <TopFilter issues={issues} showSearch={showSearch} searchType={searchType}
        setSearchType={setSearchType}/>
      <IssueList issues={issues} />
      {searchType === 'chat' && <div className="grow">{chatResult}</div>}
    </div>
  )
}

export default List
