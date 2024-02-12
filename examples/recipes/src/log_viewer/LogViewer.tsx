import { useCallback, useEffect, useState } from 'react'
import { LogViewerView } from './LogViewerView'
import { useLogs } from './use_logs'

export const LogViewer = ({
  defaultNumLogsToShow = 10,
  additionalLogsToShow = 10,
}: {
  defaultNumLogsToShow?: number
  additionalLogsToShow?: number
}) => {
  const [numLogsToShow, setNumLogsToShow] = useState(defaultNumLogsToShow)
  const [searchFilter, setSearchFilter] = useState('')

  const { logs, totalNumberOfLogs } = useLogs({
    maxNumberOfLogs: numLogsToShow,
    searchFilter,
  })

  // Reset number of logs shown when updating search filter
  useEffect(() => {
    if (searchFilter.length > 0) setNumLogsToShow(defaultNumLogsToShow)
  }, [searchFilter, defaultNumLogsToShow])

  const handleShowMore = useCallback(
    () => setNumLogsToShow((currentNum) => currentNum + additionalLogsToShow),
    [additionalLogsToShow],
  )

  // Any custom view for showing and filtering logs
  return (
    <LogViewerView
      logs={logs}
      numHiddenLogs={totalNumberOfLogs - numLogsToShow}
      onSearchFilterChange={setSearchFilter}
      onShowMoreLogs={handleShowMore}
    />
  )
}
