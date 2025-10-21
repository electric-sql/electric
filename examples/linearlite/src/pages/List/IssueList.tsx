import { CSSProperties } from "react"
import {
  FixedSizeList as List,
  areEqual,
  type ListOnItemsRenderedProps,
} from "react-window"
import { memo } from "react"
import AutoSizer from "react-virtualized-auto-sizer"
import IssueRow from "./IssueRow"
import { Issue } from "../../types/types"

// Type-fixed component to work around React 18/19 JSX strictness

const ListFixed = List as any

export interface IssueListProps {
  issues: (Issue | undefined)[]
  onItemsRendered?: (props: ListOnItemsRenderedProps) => void
}

function IssueList({ issues, onItemsRendered }: IssueListProps) {
  return (
    <div className="grow">
      <AutoSizer>
        {({ height, width }) => (
          <ListFixed
            height={height}
            itemCount={issues.length}
            itemSize={36}
            itemData={issues}
            width={width}
            onItemsRendered={onItemsRendered}
          >
            {VirtualIssueRow}
          </ListFixed>
        )}
      </AutoSizer>
    </div>
  )
}

const VirtualIssueRow = memo(
  ({
    data: issues,
    index,
    style,
  }: {
    data: (Issue | undefined)[]
    index: number
    style: CSSProperties
  }) => {
    const issue = issues[index]
    return (
      <IssueRow
        key={`issue-${issue?.id ?? `index${  index}`}`}
        issue={issue}
        style={style}
      />
    )
  },
  areEqual
)

export default memo(IssueList)
