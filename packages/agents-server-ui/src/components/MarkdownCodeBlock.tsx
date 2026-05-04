import {
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { useIsCodeFenceIncomplete } from 'streamdown'
import {
  highlightCodeTokens,
  type HighlightTokensResult,
} from '../lib/codeHighlighter'
import { IconButton, Tooltip } from '../ui'

// Streamdown threads its rehype `Element` through every component
// override as a `node` prop. We strip it from the rest spread so
// React doesn't warn about unknown DOM attributes on `<code>`.
//
// Streamdown's default `pre` override decorates the inner `code`
// with a `data-block` attribute (cloneElement) so this `code`
// override can dispatch between fenced blocks and inline backticks
// purely on the presence of that prop.
type CodeProps = React.HTMLAttributes<HTMLElement> & {
  node?: unknown
  [`data-block`]?: string | boolean
}

const LANGUAGE_RE = /^language-([\w-]+)$/

const EXTENSION_FOR_LANG: Record<string, string> = {
  typescript: `ts`,
  tsx: `tsx`,
  javascript: `js`,
  jsx: `jsx`,
  json: `json`,
  jsonc: `jsonc`,
  html: `html`,
  css: `css`,
  scss: `scss`,
  less: `less`,
  shellscript: `sh`,
  bash: `sh`,
  shell: `sh`,
  sh: `sh`,
  zsh: `sh`,
  markdown: `md`,
  mdx: `mdx`,
  python: `py`,
  java: `java`,
  c: `c`,
  cpp: `cpp`,
  yaml: `yml`,
  sql: `sql`,
  xml: `xml`,
  graphql: `graphql`,
  r: `r`,
  julia: `jl`,
}

function extractLanguage(className: string | undefined): string {
  if (!className) return ``
  for (const cls of className.split(/\s+/)) {
    const match = LANGUAGE_RE.exec(cls)
    if (match) return match[1]!
  }
  return ``
}

// Streamdown calls our `code` override with `children` that may be:
//   - a string (when there's no animate plugin / streaming markup)
//   - a React element wrapping a string (when there is)
//   - an array containing a mix of the above (rare, but possible)
// Walk the tree to flatten everything into a single string of code.
function extractCodeText(children: React.ReactNode): string {
  if (children == null) return ``
  if (typeof children === `string`) return children
  if (typeof children === `number`) return String(children)
  if (Array.isArray(children)) return children.map(extractCodeText).join(``)
  if (isValidElement(children)) {
    const el = children as ReactElement<{ children?: React.ReactNode }>
    return extractCodeText(el.props.children)
  }
  return ``
}

/**
 * Custom `code` renderer used as a Streamdown `components.code`
 * override. Replaces the entire Streamdown CodeBlock chain (which
 * carries inert Tailwind utility class strings on every wrapper)
 * with a clean DOM whose only styling hooks are stable
 * `data-md-code-block-*` attributes that match selectors in
 * `markdown.css`.
 *
 * Inline-vs-block dispatch follows Streamdown's contract: the
 * default `pre` override sets `data-block="true"` on the child
 * `<code>`, so its presence is the marker for a fenced block.
 *
 * Highlighting goes through `highlightCodeTokens` from
 * `lib/codeHighlighter.ts` — same Shiki singleton the streamdown
 * code plugin uses, so themes / supported languages stay in lockstep
 * across the two render paths. The component renders unhighlighted
 * code immediately and re-renders with tokens when the highlighter
 * has finished its async warm-up. While the surrounding text is
 * still streaming we skip highlighting entirely (Shiki is the most
 * expensive thing in the markdown render loop).
 *
 * Pair with `controls={{ code: false }}` on the Streamdown root
 * to suppress streamdown's own toolbar markup elsewhere in the tree
 * (mermaid blocks, etc.) — this component supplies its own.
 */
export function MarkdownCodeBlock({
  children,
  className,
  node: _node,
  'data-block': dataBlock,
  ...rest
}: CodeProps): React.ReactElement {
  // Inline backtick spans — `<code>foo</code>` inside prose. Render
  // a bare `<code data-md-inline-code>` so `markdown.css` can style
  // it as a small chip. No toolbar, no highlighting.
  if (dataBlock === undefined) {
    return (
      <code data-md-inline-code="" className={className} {...rest}>
        {children}
      </code>
    )
  }

  return (
    <FencedCodeBlock className={className} rest={rest}>
      {children}
    </FencedCodeBlock>
  )
}

function FencedCodeBlock({
  children,
  className,
  rest,
}: {
  children: React.ReactNode
  className?: string
  rest: React.HTMLAttributes<HTMLElement>
}): React.ReactElement {
  const language = extractLanguage(className)
  const codeText = extractCodeText(children)
  const isIncomplete = useIsCodeFenceIncomplete()

  // Hold the highlight result in component state. We start with
  // whatever `highlightCodeTokens` can give us synchronously (null
  // until Shiki has loaded) and update once the async-warm callback
  // fires. While `isIncomplete` is true (the fence is still being
  // streamed) we deliberately skip highlighting — re-running Shiki
  // on every keystroke is the single biggest cost during streaming
  // and the user doesn't notice the missing colours mid-stream.
  const [tokens, setTokens] = useState<HighlightTokensResult | null>(() =>
    isIncomplete || !language ? null : highlightCodeTokens(codeText, language)
  )

  // Re-highlight whenever the relevant inputs change. The callback
  // path covers the case where Shiki was still loading on first
  // render: it'll call back with the result once it's ready.
  const lastInputsRef = useRef<{ code: string; lang: string } | null>(null)
  useEffect(() => {
    if (isIncomplete || !language) {
      lastInputsRef.current = null
      setTokens(null)
      return
    }
    const last = lastInputsRef.current
    if (last && last.code === codeText && last.lang === language) return
    lastInputsRef.current = { code: codeText, lang: language }

    let cancelled = false
    const sync = highlightCodeTokens(codeText, language, (result) => {
      if (cancelled) return
      setTokens(result)
    })
    setTokens(sync)

    return () => {
      cancelled = true
    }
  }, [codeText, language, isIncomplete])

  return (
    <div data-md-code-block="" data-md-code-block-language={language || `text`}>
      <div data-md-code-block-row="">
        <div data-md-code-block-header="">
          <span>{language || `text`}</span>
        </div>
        <CodeBlockToolbar code={codeText} language={language} />
      </div>
      <div data-md-code-block-body="">
        <pre {...rest}>
          {tokens ? (
            <code>
              {tokens.tokens.map((line, i) => (
                <span data-md-code-block-line="" key={i}>
                  {line.length === 0
                    ? // Empty lines need at least a non-breaking space
                      // so the row still has a baseline + visible height.
                      `\u00A0`
                    : line.map((token, j) => (
                        <span
                          key={j}
                          style={tokenStyle(token.color, token.htmlStyle)}
                        >
                          {token.content}
                        </span>
                      ))}
                </span>
              ))}
            </code>
          ) : (
            <code>{codeText}</code>
          )}
        </pre>
      </div>
    </div>
  )
}

// Shiki returns per-token colours via `htmlStyle` (an inline-style
// object with `--shiki-light`, `--shiki-dark`, etc. CSS variables)
// plus a fallback `color`. CSS in `markdown.css` reads those vars to
// switch colours per theme; we just have to forward them as
// inline-style props.
function tokenStyle(
  color: string | undefined,
  htmlStyle: Record<string, string> | undefined
): React.CSSProperties {
  const out: Record<string, string> = {}
  if (color) out.color = color
  if (htmlStyle) Object.assign(out, htmlStyle)
  return out as React.CSSProperties
}

function CodeBlockToolbar({
  code,
  language,
}: {
  code: string
  language: string
}): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 1200)
    } catch {
      // Permission denied / unsupported — silently no-op so we don't
      // surface a noisy error for a transient feature.
    }
  }

  const download = () => {
    const ext = EXTENSION_FOR_LANG[language] ?? `txt`
    const blob = new Blob([code], { type: `text/plain` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement(`a`)
    a.href = url
    a.download = `code.${ext}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div data-md-code-block-actions="">
      <Tooltip content={copied ? `Copied!` : `Copy code`} side="top">
        <IconButton
          size={1}
          variant="ghost"
          tone="neutral"
          aria-label="Copy code"
          onClick={() => void copy()}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </IconButton>
      </Tooltip>
      <Tooltip content="Download code" side="top">
        <IconButton
          size={1}
          variant="ghost"
          tone="neutral"
          aria-label="Download code"
          onClick={download}
        >
          <Download size={12} />
        </IconButton>
      </Tooltip>
    </div>
  )
}
