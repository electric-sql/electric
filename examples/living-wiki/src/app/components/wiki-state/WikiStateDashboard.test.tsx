import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { WikiStateDashboardViewModel } from './WikiStateDashboard'
import { WikiStateDashboard } from './WikiStateDashboard'

const emptyViewModel: WikiStateDashboardViewModel = {
  activityEvents: [],
  members: [],
  sources: { submitted: [], published: [], rejected: [] },
  graphSummary: {
    pages: { proposed: 0, canonical: 0, rejected: 0, total: 0 },
    links: { proposed: 0, canonical: 0, rejected: 0, total: 0 },
    totalPages: 0,
    totalLinks: 0,
  },
  reviewSummary: {
    open: 0,
    approved: 0,
    rejected: 0,
    total: 0,
    hasOpenItems: false,
  },
}

describe(`WikiStateDashboard`, () => {
  it(`renders friendly empty shared-state panels`, () => {
    render(<WikiStateDashboard viewModel={emptyViewModel} />)
    expect(
      screen.getByRole(`region`, { name: `Living wiki shared-state dashboard` })
    ).toBeInTheDocument()
    expect(
      screen.getByText(`No activity yet. New wiki updates will appear here.`)
    ).toBeInTheDocument()
    expect(
      screen.getByText(`No members have joined the shared-state view yet.`)
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        `No sources yet. Submitted links and notes will be grouped here.`
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(`The graph is waiting for proposed pages and links.`)
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        `No review items yet. Curator decisions will appear here.`
      )
    ).toBeInTheDocument()
  })

  it(`renders non-empty dashboard text`, () => {
    render(
      <WikiStateDashboard
        viewModel={{
          activityEvents: [
            {
              id: `event_a`,
              wiki_space_id: `wiki_test`,
              occurred_at: `2026-06-03T00:00:00.000Z`,
              actor_id: `actor_ada`,
              actor_kind: `human`,
              event_type: `source_submitted`,
              summary: `Ada submitted a source`,
              subject_type: `source`,
              subject_id: `source_a`,
              visibility: `ambient`,
              metadata: {},
            },
          ],
          members: [
            {
              membershipId: `membership_ada`,
              actorId: `actor_ada`,
              displayName: `Ada`,
              actorKind: `human`,
              avatarColor: `blue`,
              role: `owner`,
              status: `active`,
              joinedAt: `2026-06-03T00:00:00.000Z`,
              actorMissing: false,
            },
          ],
          sources: {
            submitted: [
              {
                id: `source_a`,
                wiki_space_id: `wiki_test`,
                kind: `text`,
                status: `submitted`,
                title: `Seed note`,
                url: null,
                text_preview: `preview`,
                submitted_by_actor_id: `actor_ada`,
                submitted_at: `2026-06-03T00:00:00.000Z`,
                published_at: null,
                metadata: {},
              },
            ],
            published: [],
            rejected: [],
          },
          graphSummary: {
            pages: { proposed: 1, canonical: 2, rejected: 0, total: 3 },
            links: { proposed: 1, canonical: 1, rejected: 0, total: 2 },
            totalPages: 3,
            totalLinks: 2,
          },
          reviewSummary: {
            open: 2,
            approved: 1,
            rejected: 0,
            total: 3,
            hasOpenItems: true,
          },
        }}
      />
    )

    expect(screen.getByText(`Ada submitted a source`)).toBeInTheDocument()
    expect(screen.getByText(`Ada`)).toBeInTheDocument()
    expect(screen.getByText(`Seed note`)).toBeInTheDocument()
    expect(
      screen.getByText(/3 total .* 2 canonical .* 1 proposed/)
    ).toBeInTheDocument()
    expect(screen.getByText(`2 open`)).toBeInTheDocument()
  })
})
