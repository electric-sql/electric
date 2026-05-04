import { useRef, useState } from 'react'
import { Copy, Download, Maximize2 } from 'lucide-react'
import {
  extractTableDataFromElement,
  tableDataToCSV,
  tableDataToMarkdown,
  tableDataToTSV,
} from 'streamdown'
import { Dialog, IconButton, Menu, Tooltip } from '../ui'
import styles from './MarkdownTable.module.css'

// Streamdown threads its rehype `Element` through every component
// override as a `node` prop. Keep it out of the `<table>` rest spread
// so React doesn't warn about unknown DOM attributes.
type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  node?: unknown
}

type CopyFormat = `md` | `csv` | `tsv`
type DownloadFormat = `md` | `csv`

const COPY_MIME: Record<CopyFormat, string> = {
  md: `text/markdown`,
  csv: `text/csv`,
  tsv: `text/tab-separated-values`,
}

const DOWNLOAD_EXT: Record<DownloadFormat, string> = {
  md: `md`,
  csv: `csv`,
}

const DOWNLOAD_MIME: Record<DownloadFormat, string> = {
  md: `text/markdown`,
  csv: `text/csv`,
}

function serializeTable(
  table: HTMLTableElement,
  format: CopyFormat | DownloadFormat
): string {
  const data = extractTableDataFromElement(table)
  switch (format) {
    case `csv`:
      return tableDataToCSV(data)
    case `tsv`:
      return tableDataToTSV(data)
    case `md`:
      return tableDataToMarkdown(data)
  }
}

/**
 * Custom table renderer used as a Streamdown `components.table`
 * override. Replaces Streamdown's built-in (Tailwind-styled, broken
 * without Tailwind) table toolbar with one built from our Base UI
 * primitives — `Menu` for the Copy / Download format dropdowns,
 * `IconButton` + `Tooltip` for the action triggers, and `Dialog` for
 * the fullscreen view.
 *
 * Because overriding `components.table` bypasses Streamdown's own
 * `MarkdownTable` wrapper component, we have to re-emit the full
 * wrapper structure here — `[data-streamdown="table-wrapper"]`
 * outer, `.border-collapse` scroll container, `[data-streamdown=
 * "table"]` on the table itself — so the existing CSS in
 * `markdown.css` (which targets those attributes) keeps applying.
 * The toolbar then sits as a direct child of the wrapper rather
 * than being portaled, which is simpler and survives streaming
 * re-renders cleanly.
 *
 * Pair with `controls={{ table: false }}` on the Streamdown root
 * to suppress streamdown's own toolbar markup.
 */
export function MarkdownTable({
  children,
  node: _node,
  ...props
}: TableProps): React.ReactElement {
  const tableRef = useRef<HTMLTableElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [copied, setCopied] = useState<CopyFormat | null>(null)

  const copy = async (format: CopyFormat): Promise<void> => {
    const table = tableRef.current
    if (!table) return
    const text = serializeTable(table, format)
    try {
      // Prefer ClipboardItem so paste targets that understand HTML
      // (Notion, Google Docs, …) get the rich table; fall back to
      // plain text otherwise.
      if (typeof ClipboardItem !== `undefined` && navigator.clipboard?.write) {
        const items = new ClipboardItem({
          [COPY_MIME[format]]: new Blob([text], { type: COPY_MIME[format] }),
          'text/plain': new Blob([text], { type: `text/plain` }),
          'text/html': new Blob([table.outerHTML], { type: `text/html` }),
        })
        await navigator.clipboard.write([items])
      } else {
        await navigator.clipboard.writeText(text)
      }
      setCopied(format)
      window.setTimeout(() => setCopied(null), 1500)
    } catch {
      // Clipboard permission denied or unsupported — silently no-op;
      // surfacing an error here would be more disruptive than the
      // missed copy.
    }
  }

  const download = (format: DownloadFormat): void => {
    const table = tableRef.current
    if (!table) return
    const text = serializeTable(table, format)
    const blob = new Blob([text], { type: DOWNLOAD_MIME[format] })
    const url = URL.createObjectURL(blob)
    const a = document.createElement(`a`)
    a.href = url
    a.download = `table.${DOWNLOAD_EXT[format]}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const toolbar = (
    <div className={styles.toolbar} data-md-table-toolbar="">
      <Menu.Root>
        <Tooltip content={copied ? `Copied!` : `Copy table`} side="top">
          <Menu.Trigger
            render={
              <IconButton
                size={1}
                variant="ghost"
                tone="neutral"
                aria-label="Copy table"
              />
            }
          >
            <Copy size={12} />
          </Menu.Trigger>
        </Tooltip>
        <Menu.Content side="bottom" align="end" sideOffset={4}>
          <Menu.Item onSelect={() => copy(`md`)}>Markdown</Menu.Item>
          <Menu.Item onSelect={() => copy(`csv`)}>CSV</Menu.Item>
          <Menu.Item onSelect={() => copy(`tsv`)}>TSV</Menu.Item>
        </Menu.Content>
      </Menu.Root>

      <Menu.Root>
        <Tooltip content="Download table" side="top">
          <Menu.Trigger
            render={
              <IconButton
                size={1}
                variant="ghost"
                tone="neutral"
                aria-label="Download table"
              />
            }
          >
            <Download size={12} />
          </Menu.Trigger>
        </Tooltip>
        <Menu.Content side="bottom" align="end" sideOffset={4}>
          <Menu.Item onSelect={() => download(`md`)}>Markdown</Menu.Item>
          <Menu.Item onSelect={() => download(`csv`)}>CSV</Menu.Item>
        </Menu.Content>
      </Menu.Root>

      <Tooltip content="View fullscreen" side="top">
        <IconButton
          size={1}
          variant="ghost"
          tone="neutral"
          aria-label="View table fullscreen"
          onClick={() => setFullscreen(true)}
        >
          <Maximize2 size={12} />
        </IconButton>
      </Tooltip>
    </div>
  )

  return (
    <>
      {/* Mirror Streamdown's `MarkdownTable` wrapper structure exactly
          so the selectors in `markdown.css`
          (`[data-streamdown="table-wrapper"]`,
          `[data-streamdown="table"]`, the `> div.border-collapse`
          scroll container) all apply. Only the toolbar slot differs:
          we render our Base UI version as a direct sibling of the
          scroll container, with `position: absolute` from the
          stylesheet pinning it to the wrapper's top-right corner. */}
      <div data-streamdown="table-wrapper">
        <div className="border-collapse">
          <table ref={tableRef} data-streamdown="table" {...props}>
            {children}
          </table>
        </div>
        {toolbar}
      </div>

      <Dialog.Root open={fullscreen} onOpenChange={setFullscreen}>
        <Dialog.Content
          maxWidth="calc(100vw - 48px)"
          className={styles.fullscreenContent}
        >
          <Dialog.Title className={styles.fullscreenTitle}>Table</Dialog.Title>
          {/* Render the same children inside a separate <table>
              instance — React reconciles each location independently
              so the data shows up in both the inline table and the
              fullscreen one without any cloning gymnastics. */}
          <div className={styles.fullscreenScroll}>
            <table data-streamdown="table" {...props}>
              {children}
            </table>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </>
  )
}
