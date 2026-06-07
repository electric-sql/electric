import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Wrench } from 'lucide-react'
import { InlineEventCard } from './InlineEventCard'

function hasNestedButton(markup: string): boolean {
  let buttonDepth = 0
  const buttonTag = /<\/?button\b[^>]*>/g
  for (const match of markup.matchAll(buttonTag)) {
    const tag = match[0]
    if (tag.startsWith(`</`)) {
      buttonDepth = Math.max(0, buttonDepth - 1)
      continue
    }
    if (buttonDepth > 0) return true
    buttonDepth += 1
  }
  return false
}

describe(`InlineEventCard`, () => {
  it(`keeps header actions outside the expandable header button`, () => {
    const markup = renderToStaticMarkup(
      <InlineEventCard
        icon={Wrench}
        title="bash"
        summary="pwd"
        actions={<button type="button">Reply</button>}
        collapsible
        defaultExpanded
      >
        <pre>result</pre>
      </InlineEventCard>
    )

    expect(hasNestedButton(markup)).toBe(false)
    expect(markup).toContain(`aria-label="Collapse details"`)
  })
})
