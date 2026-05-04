# Claude Code skills for `@electric-ax/coding-agents`

Skills that wrap the package's CLIs for use from inside a Claude Code session.

## Installing

Copy a skill directory to your `~/.claude/skills/` (user-level) or to the project's `.claude/skills/` (project-level):

```bash
# user-level: available in every Claude Code session
cp -R claude-skills/electric-import ~/.claude/skills/

# project-level: only in this repo
mkdir -p .claude/skills
cp -R claude-skills/electric-import .claude/skills/
```

After copying, restart Claude Code — skills are scanned at session start.

## Available skills

| Name                                          | What it does                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| [electric-import](./electric-import/SKILL.md) | Import the active Claude Code session into a running electric-agents server. |

## Adding a new skill

A skill is a directory containing `SKILL.md` with frontmatter `name` + `description`, plus instructions in markdown. The `description` is the trigger — Claude Code matches it against user intent. Keep it concrete; vague descriptions don't fire reliably.

For codex / opencode equivalents, see `electric-import/SKILL.md` § Out of scope.
