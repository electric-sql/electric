import { CSSProperties } from 'react'
import StatusIcon from '../../components/StatusIcon'
import { memo } from 'react'
import {
  Droppable,
  DroppableProvided,
  DroppableStateSnapshot,
  Draggable,
  DraggableProvided,
  DraggableStateSnapshot,
} from 'react-beautiful-dnd'
import { FixedSizeList as List, areEqual } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'
import IssueItem, { itemHeight } from './IssueItem'
import { Issue } from '../../types/types'

// Type-fixed components to work around React 18/19 JSX strictness
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DroppableFixed = Droppable as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DraggableFixed = Draggable as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ListFixed = List as any

interface Props {
  status: string
  title: string
  issues: Array<Issue> | undefined
}

const itemSpacing = 8

function IssueCol({ title, status, issues = [] }: Props) {
  const statusIcon = <StatusIcon status={status} />

  return (
    <div className="flex flex-col flex-shrink-0 mr-3 select-none w-90">
      <div className="flex items-center justify-between pb-3 text-sm">
        <div className="flex items-center">
          {statusIcon}
          <span className="ml-3 mr-3 font-medium">{title} </span>
          <span className="mr-3 font-normal text-gray-400">
            {issues?.length || 0}
          </span>
        </div>
      </div>
      <DroppableFixed
        droppableId={status}
        key={status}
        type="category"
        mode="virtual"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        renderClone={(provided: any, snapshot: any, rubric: any) => {
          const issue = issues[rubric.source.index]
          return (
            <IssueItem
              provided={provided}
              issue={issue}
              isDragging={snapshot.isDragging}
              index={rubric.source.index}
              // style={provided.draggableProps.style}
            />
          )
        }}
      >
        {(
          droppableProvided: DroppableProvided,
          snapshot: DroppableStateSnapshot
        ) => {
          // Add an extra item to our list to make space for a dragging item
          // Usually the DroppableProvided.placeholder does this, but that won't
          // work in a virtual list
          const itemCount: number = snapshot.isUsingPlaceholder
            ? issues.length + 1
            : issues.length

          return (
            <div className="grow">
              <AutoSizer>
                {({ height, width }) => (
                  <ListFixed
                    height={height}
                    itemCount={itemCount}
                    itemSize={itemHeight + itemSpacing}
                    width={width}
                    outerRef={droppableProvided.innerRef}
                    itemData={issues}
                    className="w-full border-gray-200 pt-0.5"
                    // ref={provided.innerRef}
                    // {...provided.droppableProps}
                  >
                    {Row}
                  </ListFixed>
                )}
              </AutoSizer>
            </div>
          )
        }}
      </DroppableFixed>
    </div>
  )
}

const Row = memo(
  ({
    data: issues,
    index,
    style,
  }: {
    data: Issue[]
    index: number
    style: CSSProperties | undefined
  }) => {
    const issue = issues[index]
    if (!issue) return null
    return (
      <DraggableFixed draggableId={issue.id} index={index} key={issue.id}>
        {(provided: DraggableProvided, snapshot: DraggableStateSnapshot) => (
          <IssueItem
            provided={provided}
            issue={issue}
            isDragging={snapshot.isDragging}
            index={index}
            style={style}
          />
        )}
      </DraggableFixed>
    )
  },
  areEqual
)

export default memo(IssueCol)
