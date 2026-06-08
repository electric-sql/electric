---
description: Create and edit collaborative markdown documents in the app workspace
whenToUse: User wants a markdown doc, notes, plan, draft, report, or document they can open and edit in the app UI
keywords:
  - markdown doc
  - collaborative document
  - notes
  - draft
  - report
  - plan
  - workspace editor
  - manifest
user-invocable: true
max: 9000
---

# Markdown Docs

Use this skill when the user wants a document that appears in the Electric
Agents UI and can be opened, edited, and watched live.

## Core Rule

Collaborative markdown docs are not filesystem files.

- Use `create_markdown_doc`, `set_markdown_doc_cursor`,
  `insert_markdown_doc`, `replace_markdown_doc_range`, `read_markdown_doc`,
  `write_markdown_doc`, and `edit_markdown_doc` for docs the user should open
  in the workspace UI.
- Use filesystem `write`/`edit` only when the user asks for an actual file path
  in the workspace or repo, such as `docs/foo.md`, `README.md`, or
  `/tmp/report.md`.

## When To Create A Collaborative Doc

Use `create_markdown_doc` when the user says things like:

- "make a markdown doc"
- "create a doc"
- "write some notes"
- "draft a plan"
- "make a report I can edit"
- "add this to the manifest"
- "create a document I can open"
- "put this in a doc"

If the user says "file", "repo", "workspace", or gives a path, ask one short
clarifying question if the destination is ambiguous.

## Create Workflow

1. Choose a concise title.
2. Use `create_markdown_doc`.
3. Include initial markdown content if the user supplied enough detail.
4. After creation, tell the user the document is available from this entity's
   manifest or timeline and can be opened in the markdown editor.

Example tool call:

```json
{
  "title": "Launch Plan",
  "content": "# Launch Plan\n\n## Goals\n\n- ...\n"
}
```

Do not also write a `.md` file unless the user explicitly asked for a filesystem
copy.

## Edit Workflow

For small edits:

1. Use `read_markdown_doc` first.
2. Use `edit_markdown_doc` with an exact `old_string`.
3. If the target text appears multiple times, make `old_string` more specific or
   set `replace_all` only when replacing every occurrence is clearly intended.

For replacing a section with new long content that should appear live:

1. Use `read_markdown_doc` if you need to inspect or disambiguate the target.
2. Use `replace_markdown_doc_range` with a unique `old_string`, or with
   `old_string` plus `occurrence` for repeated text.
3. For exact offsets, use `index` plus `length` instead of `old_string`.
4. Put the range selector before `content` in the tool arguments so the range is
   deleted once and replacement content can stream into that Yjs-relative
   position.

The markdown tools materialize the collaborative Yjs document from its durable
stream during the wake. `write_markdown_doc`, `edit_markdown_doc`,
`insert_markdown_doc`, and `replace_markdown_doc_range` append binary Yjs
updates to that stream; do not write markdown documents to the local filesystem
unless the user explicitly asks for a filesystem file.

For broad rewrites:

1. Use `read_markdown_doc` first unless you just created or wrote the doc in the
   same wake.
2. Use `write_markdown_doc` with the full replacement markdown.

For adding new long content to an existing doc:

1. Use `read_markdown_doc` if you need to inspect the target location.
2. Use `set_markdown_doc_cursor` with `index`, `before`, or `after` when the
   insertion belongs at a specific location.
3. Use `insert_markdown_doc`.
4. Pass `id` and optional `index` before `content` in the tool arguments. If
   `index` is omitted, the saved Yjs-relative cursor is used; if no cursor is
   set, the content is appended to the current document.

Both write and edit tool results include diffs. Use those diffs to summarize
what changed.

## Response Style

After creating a doc, keep the response short:

- State the title.
- State that it is available in the manifest/timeline.
- Mention any useful next action, such as "open it to edit collaboratively".

Do not paste the entire document back into chat unless the user asks.
