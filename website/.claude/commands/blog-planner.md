# Blog Planner

Interactive blog post authoring for the Electric blog. Walks through
structured Q&A to produce a draft blog post file with outline, inline
guidance comments, and meta briefs that the author proses up in place.

## Instructions

Follow the authoring flow defined in the blog-planner skill
(`website/.claude/skills/blog-planner/SKILL.md`). Work through all
phases in order:

1. **Intake** — Understand the raw idea, identify the author, read any
   existing material
2. **Sharpen intent** — Nail down what the post is about, why it matters,
   reader takeaway, CTAs, and authority
3. **Choose format** — Recommend and confirm one of: Pyramid Principle,
   Best Sales Deck, or Release Post
4. **Draft the outline** — Section-level outline per the chosen format,
   with inline HTML comments for structural guidance
5. **Ethos / creative angle** — For pyramid and sales deck formats,
   draw out the author's personal angle
6. **Evaluate** — Check the outline delivers on the intent
7. **Fill in the meta** — Title brief, description brief, excerpt brief,
   image prompt, open questions
8. **Gather assets** — Inventory code samples, diagrams, demos, screenshots
9. **Write the file** — Save to `website/blog/posts/YYYY-MM-DD-slug.md`
   with `published: false`

Ask one question at a time. Be direct and useful.

$ARGUMENTS
