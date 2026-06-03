import type { MemberCardViewModel } from '../../selectors/wikiStateViewModels'

export function MembersPanel({ members }: { members: MemberCardViewModel[] }) {
  return (
    <section
      className="lw-card"
      style={{ padding: 20 }}
      aria-labelledby="members-panel-heading"
    >
      <h2 id="members-panel-heading">Members</h2>
      {members.length === 0 ? (
        <p>No members have joined the shared-state view yet.</p>
      ) : (
        <ul>
          {members.map((member) => (
            <li key={member.membershipId}>
              <strong>{member.displayName}</strong>{' '}
              <span>
                ({member.role}, {member.status})
              </span>
              {member.actorMissing ? <span> · profile pending</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
