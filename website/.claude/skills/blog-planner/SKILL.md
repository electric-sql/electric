---
name: blog-planner
description: >
  Interactive blog post authoring. Produces a draft blog post file
  with structured outline, inline guidance comments, and meta briefs that
  the author proses up in place. Supports pyramid principle, best sales deck,
  and release post formats.
---

# Blog Planner

Plan and outline blog posts for the Electric blog. The output is a draft
markdown file placed directly in `website/blog/posts/` with
`published: false`. The author works through the outline in place, expanding
compressed bullets into prose and swapping in assets.

## Invocation

```
/blog-planner [optional: path to existing draft or reference material]
```

If the user provides a path to existing material (drafts, docs, PRDs, notes),
read it for context and content. Understand what it contains but do not
over-index on its structure — the outline's structure comes from the chosen
format, not the source material.

## Authoring flow

Work through these phases in order. Ask one question at a time. Be clear,
honest, and useful. Don't gamify the questioning or perform — add value
and get out of the author's way.

### Phase 1: Intake

Understand the raw idea.

- What is the post about?
- Who is the author? (Use author keys from the Electric blog: `thruflo`,
  `kyle`, `samwillis`, `icehaunter`, `balegas`, `oleksii`, `purva`)
- Is there existing material to reference? (Drafts, PRDs, RFCs, demos,
  PRs, docs.) If so, read it now.

### Phase 2: Sharpen intent

Nail down why this post deserves to exist. Push until each answer is crisp.

- **What is this post about?** — One sentence.
- **What's interesting about it?** — Why would the reader care? What's the hook?
- **What's the reader takeaway?** — After reading, what does the reader know
  or believe that they didn't before?
- **What are the CTAs / next steps?** — What should the reader do after reading?
- **Why are we / the author the right people to write this?** — What authority
  or experience makes this credible?

These answers form the Intent block in the output file's meta section.

### Phase 3: Choose format

Based on the intent, recommend one of the three formats and confirm with
the author. If the author picks a format, use that format — don't second-guess.

| Format | When to use |
|--------|-------------|
| **Pyramid Principle** | You have a clear point to make and need to build a logical argument. Good for technical explanations, "how we built X", opinion pieces with substance. |
| **Best Sales Deck** | You're introducing a concept or paradigm shift. A narrative flow that names a big change in the world, shows winners and losers, teases the promised land, and introduces the solution. Good for product launches that represent a category shift, thought leadership. |
| **Release Post** | You shipped something. Communicate it clearly. The workhorse format for incremental releases and new features. Always be shipping. |

Once confirmed, load the corresponding reference file from `references/`.

### Phase 4: Draft the outline

Produce the section-level outline per the chosen format.

- Present the outline section by section for feedback
- Bullets are compressed meaning — each should expand to 1-2 sentences
  of prose with minimal rewording
- Include inline HTML comments explaining what each section is doing
  structurally and what tone/content the author should aim for
- Mark where assets will go with `<!-- ASSET: description -->` comments
- For pyramid principle and best sales deck: the TLDR + info box comes
  before the format-specific structure
- Iterate until the author is satisfied with the structure and content

**Writing style for outline bullets:**
- Compressed, direct, specific
- Each bullet carries one clear idea
- Bullets often combine into fresh prose because they are compressed
  expressions of meaning — optimise for this
- Avoid: "robust", "scalable", "flexible", "leverage", "ecosystem",
  "game-changing", "revolutionary" — say what you actually mean
- No LLM tells — no "it's worth noting", "importantly", "in conclusion",
  "let's dive in", "at its core", "in today's landscape"

### Phase 5: Ethos / creative angle

For **pyramid principle** and **best sales deck** formats only.

Draw out the author's personal angle:
- Is there a specific moment, experience, or anecdote that makes this real?
- Is there a creative framing that makes the setup more vivid?

Weave this into the outline bullets for the Situation/Complication (pyramid)
or Big Change (best sales deck) sections. Annotate with comments explaining
how the creative element works structurally. This is done now, not left to
the author to figure out during prose-up.

### Phase 6: Evaluate

Assess whether the outline delivers on the intent from Phase 2.

- Does the structure serve the point of the post?
- Does the logic hold? (Informal — does it hang together, not a PhD defence)
- Are there gaps or weak sections?
- Would the reader reach the intended takeaway by following the outline?
- Is the hook strong enough?

Raise any issues and iterate with the author.

### Phase 7: Fill in the meta

Return to the footer meta section. Draft briefs for:

- **Title brief** — Direction for the final title. Titles use sentence case,
  not Title Case.
- **Description brief** — For SEO. No HTML. What should it convey?
- **Excerpt brief** — For the blog listing card. Max 3 short sentences.
  Match word length of existing post excerpts for consistent listing display.
- **Image prompt** — See image brief guidelines below. If a detailed image
  brief is needed, suggest the author use the `/blog-image-brief` command.
- **Open questions** — Anything unresolved.

### Phase 8: Gather assets

Now that the outline is solid, inventory the assets needed:

- Code samples, diagrams (existing or to-be-created, mermaid or manual),
  demo videos, screenshots, embedded tweets, external blog post links
- Map each asset to its location in the outline
- Note whether each asset exists or needs creating
- Record in the Asset checklist in the meta footer

### Phase 9: Write the file

Save the outline to `website/blog/posts/YYYY-MM-DD-slug.md`.

- Use today's date for the filename prefix
- Derive the slug from the working title (kebab-case)
- Set `published: false` in frontmatter
- Use `...` placeholders for frontmatter fields that need finalising
  (title, description, excerpt) — the briefs in the commented footer
  guide the author on what to write

## Output format

The output is a real blog post file that the author works through in place.

### Frontmatter

```yaml
---
title: '...'
description: >-
  ...
excerpt: >-
  ...
authors: [author-key]
image: /img/blog/slug/header.jpg
tags: [...]
outline: [2, 3]
post: true
published: false
---
```

Use `...` for title, description, and excerpt. These get filled in by the
author using the briefs in the meta footer. Tags can be populated from
the intent discussion.

### Body structure

All formats follow this pattern:

1. **TLDR opener** — 1-2 short paragraphs stating what this is and why it
   matters. Compressed, no setup, no marketing tone. Technical audience
   wants the point immediately. Followed by an info box with key links.
2. **Format-specific body** — Section structure per the chosen format
   reference. Inline HTML comments guide the author on each section's
   purpose and tone.
3. **Next steps** — CTAs, links, what to do now.
4. **`***` separator**
5. **Commented meta footer** — Intent, title brief, description brief,
   excerpt brief, image prompt, asset checklist, open questions.
   Prefixed with instruction to delete before publishing.

### Inline comments

Use HTML comments for:

- **Structural guidance**: What this section is doing in the format's logic
- **Tone direction**: How the author should write this section
- **Asset markers**: `<!-- ASSET: description -->` where assets go
- **Author notes**: Specific instructions for expanding particular bullets

Comments don't render in markdown and the author deletes them as they
prose up each section.

## Typesetting guidelines

Include these as a checklist in the meta footer:

- Use non-breaking spaces (`&nbsp;` in HTML, `\u00A0` in frontmatter)
  and non-breaking hyphens where appropriate to avoid widows and orphans
- Titles MUST use sentence case, not Title Case
- Check title, image, and general post at different screen widths
- Avoid LLM tells: "it's worth noting", "importantly", "in conclusion",
  "let's dive in", "at its core", "in today's landscape"

## Reference blog posts

Existing posts by Electric authors that exemplify good execution. Use these
to calibrate tone, structure, and quality.

**Pyramid principle / narrative:**
- [Durable sessions for collaborative AI](https://github.com/electric-sql/electric/blob/main/website/blog/posts/2026-01-12-durable-sessions-for-collaborative-ai.md) — thruflo
- [Bringing agents back down to earth](https://github.com/electric-sql/electric/blob/main/website/blog/posts/2025-08-12-bringing-agents-back-down-to-earth.md) — thruflo
- [Building AI apps on sync](https://github.com/electric-sql/electric/blob/main/website/blog/posts/2025-04-09-building-ai-apps-on-sync.md) — thruflo

**Best sales deck / concept:**
- [Announcing Durable Streams](https://github.com/electric-sql/electric/blob/main/website/blog/posts/2025-12-09-announcing-durable-streams.md) — kyle, samwillis
- [Super-fast apps on sync with TanStack DB](https://github.com/electric-sql/electric/blob/main/website/blog/posts/2025-07-29-super-fast-apps-on-sync-with-tanstack-db.md) — thruflo

**Release post:**
- [Electric 1.0 released](https://github.com/electric-sql/electric/blob/main/website/blog/posts/2025-03-17-electricsql-1.0-released.md) — thruflo
- [Announcing Hosted Durable Streams](https://github.com/electric-sql/electric/blob/main/website/blog/posts/2026-01-22-announcing-hosted-durable-streams.md) — kyle

## Image brief (quick version)

For a quick image direction, note in the meta footer:
- Subject/concept for the image
- Aspect ratio: 16:9 to 16:10 (target ~1536x950px)
- Master as high-quality JPG
- Center-center composition — key content in inner frame
  (responsive cropping will cut edges)
- Brand colors: `#D0BCFF` (purple), `#00d2a0` (green), `#75fbfd` (cyan),
  `#F6F95C` (yellow), `#FF8C3B` (orange)
- Dark theme background
- Site uses OpenSauceOne font

For a detailed image brief with reference image analysis and a full
ChatGPT DALL-E prompt, use the `/blog-image-brief` command separately.

## Review

Once the author has prosed up the outline, use `/blog-review` to review
the draft against the outline, format, and execution guidelines.
