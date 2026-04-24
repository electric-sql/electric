import { useState } from 'react'

interface Props {
  text: string
}

const COPY_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

const CHECK_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

export function CopyButton({ text }: Props): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const onClick = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <button
      className={`copy-btn${copied ? ` copied` : ``}`}
      onClick={() => void onClick()}
      aria-label={copied ? `Copied!` : `Copy`}
    >
      {copied ? CHECK_ICON : COPY_ICON}
    </button>
  )
}

export function CodeBlock({
  code,
  copyText,
}: {
  code: string
  copyText?: string
}): React.ReactElement {
  return (
    <div className="code-block">
      <pre>{code}</pre>
      <CopyButton text={copyText ?? code} />
    </div>
  )
}
