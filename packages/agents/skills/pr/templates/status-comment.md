## 🤖 Agent status — PR #{number}

| Gate               | State                                                 |
| ------------------ | ----------------------------------------------------- |
| Template           | {✅ \| ⏳ \| 🔴 (reason)}                             |
| CI                 | {✅ \| ⏳ pending (n checks running) \| 🔴 n failing} |
| Conflicts          | {✅ \| 🔴 (rebase needed)}                            |
| Review threads     | {✅ \| 🔴 n open must-fix}                            |
| Docs               | {✅ \| ⏳ in-progress \| 🔴 needed}                   |
| **Ready to merge** | {✅ \| ⏳}                                            |

### Active agents

- {✅ \| 🔴 paused} reviewer ({iterations}/{cap} cycles)
- {✅ \| 🔴 paused} build-doctor ({iterations}/{cap} cycles)
- {✅ \| 🔴 paused} doc-editor ({iterations}/{cap} cycles)

### Paused agents

{- **{role}** — {pause*reason}. Reply `/continue {role}` to resume.}
{\_None* if no paused agents}

### Recent agent commits

{- `{sha}` `[agent:{role}] {subject}` — {ago}}

---

_Disable agents on this PR with `/stop` or by removing the `agents` label._

<!-- agent-managed-status -->
