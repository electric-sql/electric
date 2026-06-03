import type { ActivityEventRow } from '../../../shared/wiki-state'

export function ActivityFeed({ events }: { events: ActivityEventRow[] }) {
  return (
    <section
      className="lw-card"
      style={{ padding: 20 }}
      aria-labelledby="activity-feed-heading"
    >
      <h2 id="activity-feed-heading">Recent activity</h2>
      {events.length === 0 ? (
        <p>No activity yet. New wiki updates will appear here.</p>
      ) : (
        <ul>
          {events.map((event) => (
            <li key={event.id}>
              <strong>{event.summary}</strong>
              <br />
              <span>
                {event.event_type} · {event.occurred_at}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
