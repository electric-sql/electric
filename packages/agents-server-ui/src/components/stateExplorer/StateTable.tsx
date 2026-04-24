import {
  Badge,
  Code,
  DataList,
  Flex,
  HoverCard,
  Link,
  Text,
} from '@radix-ui/themes'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import styles from './StateTable.module.css'
import type { ColumnResizeMode, SortingState } from '@tanstack/react-table'
import type { MaterializedState } from '@durable-streams/state'

// ============================================================================
// FK column detection
// ============================================================================

/** Match `something_id` or `somethingId` → extract `something` */
function extractFkType(columnName: string): string | null {
  const snakeMatch = columnName.match(/^(.+)_id$/)
  if (snakeMatch) return snakeMatch[1]
  const camelMatch = columnName.match(/^(.+)Id$/)
  if (camelMatch) {
    const name = camelMatch[1]
    return name.charAt(0).toLowerCase() + name.slice(1)
  }
  return null
}

function detectFkColumns(
  columns: Array<string>,
  state: MaterializedState
): Map<string, string> {
  const knownTypes = new Set(state.types)
  const fkMap = new Map<string, string>()
  for (const col of columns) {
    const refType = extractFkType(col)
    if (refType && knownTypes.has(refType)) {
      fkMap.set(col, refType)
    }
  }
  return fkMap
}

// ============================================================================
// Row type
// ============================================================================

type StateRow = { _key: string } & Record<string, unknown>

const ROW_HEIGHT = 32
const columnHelper = createColumnHelper<StateRow>()

// ============================================================================
// StateTable
// ============================================================================

export function StateTable({
  state,
  selectedType,
  highlightKey,
  onNavigateToRow,
}: {
  state: MaterializedState
  selectedType: string | null
  highlightKey: string | null
  onNavigateToRow: (type: string, key: string) => void
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnSizing, setColumnSizing] = useState({})
  const columnResizeMode: ColumnResizeMode = `onChange`

  const typeMap = useMemo(() => {
    if (!selectedType) return new Map<string, unknown>()
    return state.getType(selectedType)
  }, [state, selectedType])

  const columnNames = useMemo(() => {
    const keys = new Set<string>()
    for (const value of typeMap.values()) {
      if (value && typeof value === `object`) {
        for (const key of Object.keys(value as object)) {
          keys.add(key)
        }
      }
    }
    return [`_key`, ...Array.from(keys)]
  }, [typeMap])

  const fkColumns = useMemo(
    () => detectFkColumns(columnNames, state),
    [columnNames, state]
  )

  const rows = useMemo(() => {
    return Array.from(typeMap.entries()).map(
      ([key, value]) =>
        ({
          _key: key,
          ...(value as Record<string, unknown>),
        }) as StateRow
    )
  }, [typeMap])

  const columns = useMemo(() => {
    return columnNames.map((col) => {
      return columnHelper.accessor(col, {
        header: col === `_key` ? `key` : col,
        size: col === `_key` ? 120 : 150,
        minSize: 60,
        cell: (info) => {
          const value = info.getValue()
          if (col === `_key`) {
            return (
              <Code size="1" variant="ghost" color="green">
                {String(value)}
              </Code>
            )
          }
          if (fkColumns.has(col)) {
            return (
              <ForeignKeyCell
                value={value}
                refType={fkColumns.get(col)!}
                state={state}
                onNavigate={onNavigateToRow}
              />
            )
          }
          return <CellValue value={value} />
        },
      })
    })
  }, [columnNames, fkColumns, state, onNavigateToRow])

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnSizing },
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const { rows: tableRows } = table.getRowModel()

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  })

  // Scroll highlighted row into view
  useEffect(() => {
    if (highlightKey === null) return
    const idx = tableRows.findIndex((r) => r.original._key === highlightKey)
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: `center` })
    }
  }, [highlightKey, tableRows, virtualizer])

  // Reset sorting when type changes
  useEffect(() => {
    setSorting([])
  }, [selectedType])

  if (!selectedType) {
    return (
      <Flex align="center" justify="center" style={{ flex: 1, minHeight: 0 }}>
        <Text size="2" color="gray">
          Select a type to view its state
        </Text>
      </Flex>
    )
  }

  const headerGroups = table.getHeaderGroups()

  return (
    <Flex
      direction="column"
      style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: `hidden` }}
    >
      <Flex align="center" gap="2" px="3" py="1" className={styles.header}>
        <Text
          size="1"
          color="gray"
          weight="medium"
          style={{ textTransform: `uppercase` }}
        >
          Records
        </Text>
        <Badge size="1" variant="soft" color="gray">
          {rows.length}
        </Badge>
      </Flex>

      {rows.length === 0 ? (
        <Flex align="center" justify="center" py="8">
          <Text size="2" color="gray">
            No rows at this point in time
          </Text>
        </Flex>
      ) : (
        <div ref={scrollContainerRef} className={styles.scrollContainer}>
          <div
            className={styles.gridTable}
            style={{ width: table.getTotalSize() }}
          >
            {/* Header */}
            <div className={styles.gridHead}>
              {headerGroups.map((headerGroup) => (
                <div key={headerGroup.id} className={styles.gridRow}>
                  {headerGroup.headers.map((header) => (
                    <div
                      key={header.id}
                      className={styles.gridTh}
                      style={{ width: header.getSize() }}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <Flex align="center" gap="1" px="2" py="1">
                        <Text size="1" color="gray" weight="medium">
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                        </Text>
                        <Text size="1" color="gray">
                          {{ asc: ` ↑`, desc: ` ↓` }[
                            header.column.getIsSorted() as string
                          ] ?? ``}
                        </Text>
                      </Flex>
                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className={styles.resizer}
                          data-resizing={
                            header.column.getIsResizing() || undefined
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Body */}
            <div
              className={styles.gridBody}
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = tableRows[virtualRow.index]
                const isHighlighted = row.original._key === highlightKey
                return (
                  <div
                    key={row.id}
                    className={`${styles.gridRow} ${styles.gridBodyRow}${isHighlighted ? ` ${styles.highlightedRow}` : ``}`}
                    style={{
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div
                        key={cell.id}
                        className={styles.gridCell}
                        style={{ width: cell.column.getSize() }}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </Flex>
  )
}

// ============================================================================
// Foreign Key Cell
// ============================================================================
function ForeignKeyCell({
  value,
  refType,
  state,
  onNavigate,
}: {
  value: unknown
  refType: string
  state: MaterializedState
  onNavigate: (type: string, key: string) => void
}) {
  const key = typeof value === `string` ? value : String(value ?? ``)
  const refRow = state.get<Record<string, unknown>>(refType, key)

  if (!refRow) {
    return <CellValue value={value} />
  }

  return (
    <HoverCard.Root>
      <HoverCard.Trigger>
        <Link
          size="1"
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onNavigate(refType, key)
          }}
          style={{ fontFamily: `var(--code-font-family)` }}
        >
          {key}
        </Link>
      </HoverCard.Trigger>
      <HoverCard.Content size="1" maxWidth="360px">
        <Flex direction="column" gap="2">
          <Text size="1" weight="medium">
            {refType}:{key}
          </Text>
          <DataList.Root size="1">
            {Object.entries(refRow).map(([field, val]) => (
              <DataList.Item key={field}>
                <DataList.Label>
                  <Text size="1" color="gray">
                    {field}
                  </Text>
                </DataList.Label>
                <DataList.Value>
                  <Code size="1" variant="ghost">
                    {typeof val === `object` && val !== null
                      ? JSON.stringify(val)
                      : String(val ?? `null`)}
                  </Code>
                </DataList.Value>
              </DataList.Item>
            ))}
          </DataList.Root>
        </Flex>
      </HoverCard.Content>
    </HoverCard.Root>
  )
}

// ============================================================================
// Cell Value Renderer
// ============================================================================
function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <Text size="1" color="gray">
        null
      </Text>
    )
  }
  if (typeof value === `object`) {
    return (
      <Code size="1" variant="ghost" style={{ whiteSpace: `nowrap` }}>
        {JSON.stringify(value)}
      </Code>
    )
  }
  if (typeof value === `boolean`) {
    return (
      <Text size="1" color={value ? `green` : `red`}>
        {String(value)}
      </Text>
    )
  }
  return (
    <Text size="1" style={{ whiteSpace: `nowrap` }}>
      {String(value)}
    </Text>
  )
}
