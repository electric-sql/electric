# Blog Review

Review a prosed-up blog post against its outline, chosen format, and
execution guidelines. Run this after the author has expanded the outline
into full prose.

## Invocation

```
/blog-review <path-to-blog-post> [optional: path-to-original-outline]
```

If an original outline exists (the version before prose-up with the
commented meta footer intact), read it for reference. Otherwise review
the post on its own merits.

## Review process

### Step 1: Read the post and context

- Read the blog post
- If an outline exists, read it and note the intended format,
  intent, and evaluation criteria
- Identify the format (pyramid principle, best sales deck, release post)
  from the meta footer or from the structure

### Step 2: Identify the core editorial questions

Before launching into detailed review, answer these four questions.
They are the primary frame for the entire review — everything else
is in service of them.

**1. Does the post have a clear point?**

Can you state the takeaway in one sentence — like a hashtag, elevator
pitch, or tweet? If you can't, the post doesn't have a clear enough
point yet. This is not the same as the topic. The topic is what the
post is *about*; the point is what the post *says*. A post about
"local-first sync" might have the point "sync makes apps feel instant
because reads never wait on the network." If the point is fuzzy,
nothing else in the review matters until it's fixed.

Test: write a single sentence summary. If it takes more than one
sentence, or if you have to use "and" to join two different ideas,
the point isn't sharp enough.

**2. Does the post have clear CTAs?**

After reading, does the reader know exactly what to do next? CTAs
should be:
- Specific (not "check out the docs" — which docs? for what?)
- Earned by the content (the CTA follows naturally from what was argued)
- Appropriately ambitious (a thought leadership piece earns a
  "rethink how you build X" CTA; a release post earns a
  "try it now" CTA)
- Present both at the end *and* where relevant inline (e.g. a code
  example that links to the getting started guide)

Flag posts where the CTAs feel bolted-on, generic, or disconnected
from the argument.

**3. Are the title, excerpt, content, and image coherent?**

These four elements are always displayed together (in blog listings,
social cards, RSS). They must tell the same story:
- Does the title promise what the content delivers?
- Does the excerpt accurately represent the post's point (from Q1)?
- Would the image make sense next to this title in a blog listing?
- If you read only the title + excerpt, would you have the right
  expectation for what's inside?

Flag any mismatch: a title that oversells, an excerpt that describes
a different post, an image concept that doesn't relate to the content,
or a description optimized for SEO keywords that don't match the
actual argument.

**4. Are there dissonant tonal elements or gaps in the argument?**

Read the post as a skeptical but fair reader:
- Does the tone shift unexpectedly? (e.g. technical and precise in
  one section, then hand-wavy marketing in the next)
- Are there logical gaps where the argument skips a step?
- Are there claims that aren't supported or examples that don't
  land?
- Does the post assume knowledge it hasn't established?
- Is there a section that feels like it belongs in a different post?
- Does the creative angle / ethos element feel authentic or forced?

These are the "something feels off" issues that readers sense but
can't always articulate. Name them specifically.

### Step 3: Launch review agents

Run the following review agents in parallel. Each agent should
address the core questions above within its domain, in addition
to the specific checks listed.

**Agent 1: Structure and format**

*Core question focus:* Does the structure serve the point (Q1)?
Does the argument hold without gaps (Q4)?

- Does the post follow the chosen format's structure?
- Does the TLDR opener deliver the point immediately?
- Do the sections flow logically?
- Does the post deliver on the stated intent?
- For pyramid: does the SCQA logic hold? Does the expansion
  follow from the answer? Are there gaps where the logic
  skips a step?
- For best sales deck: is the big change undeniable? Does the
  promised land describe outcomes not features? Do gifts deliver
  on the promised land or is there a gap?
- For release: can the reader understand what shipped in 30 seconds?
  Can they get started immediately?
- Is there a single clear takeaway, or does the post try to make
  multiple points? (Report finding for Q1)
- Do the CTAs follow from the argument or feel disconnected?
  (Report finding for Q2)

**Agent 2: Writing quality and tone**

*Core question focus:* Is the tone consistent throughout (Q4)?
Does the prose deliver the point clearly (Q1)?

- Is the prose clear, direct, and specific?
- Are bullets expanded naturally or does it read like inflated
  bullet points?
- Is there unnecessary preamble or throat-clearing?
- LLM tells: flag any instances of "it's worth noting",
  "importantly", "in conclusion", "let's dive in", "at its core",
  "in today's landscape", "let's explore", "in the world of",
  "when it comes to", "it's important to note"
- Banned words: flag "robust", "scalable", "flexible", "leverage",
  "ecosystem", "game-changing", "revolutionary", "seamlessly",
  "holistic", "synergy"
- Is the tone consistent across sections? Flag any shifts — e.g.
  technical precision giving way to vague marketing, or confident
  assertions followed by unnecessary hedging (Report finding for Q4)
- Does the ethos / creative angle land or feel forced?
- Could you summarize the post's point in a single hashtag-length
  phrase? If the prose makes this hard, the point is getting lost
  in the writing (Report finding for Q1)

**Agent 3: Packaging and execution**

*Core question focus:* Are title, excerpt, content, and image
coherent (Q3)? Are CTAs specific and earned (Q2)?

- **Coherence check (Q3):**
  - Read title, description, excerpt, and image path/brief together
  - Do they all describe the same post?
  - Does the title promise what the content delivers?
  - Does the excerpt capture the point (not just the topic)?
  - Is the image concept aligned with the title and content?
  - Would title + excerpt set the right expectation in a blog
    listing or social card?
- **CTA check (Q2):**
  - Is there a clear next-steps / CTA section?
  - Are CTAs specific? ("Read the getting started guide" not
    "check out the docs")
  - Do CTAs appear inline where natural, not just at the end?
  - Are the CTAs earned by the content that precedes them?
- Typesetting:
  - Non-breaking spaces (`&nbsp;`) used where appropriate to
    avoid widows and orphans?
  - Non-breaking hyphens used in compound terms that shouldn't break?
  - Can use Unicode literal `\u00A0` in frontmatter title
  - HTML entities in body text
- Title: uses sentence case, not Title Case?
- Frontmatter complete? (title, description, excerpt, authors,
  image, tags, outline, post: true)
- Description: no HTML, suitable for SEO meta tags?
- Excerpt: max 3 short sentences, consistent word length with
  other posts on the blog?
- Image: path exists or is clearly marked as TODO?
  Aspect ratio guidance followed?
- Code samples: correct language hints, runnable, well-formatted?
- Links: all internal links use root-relative paths?
  External links valid?
- Assets: all asset placeholders from the outline resolved?
- `published: false` still set (or intentionally flipped)?
- Check how title and opening will look at mobile widths —
  flag overly long titles

### Step 4: Synthesise findings

Combine agent findings. Structure the synthesis around the four
core questions first, then detail issues by severity.

**Core assessment** (2-3 sentences):
- State the post's point as you understand it (Q1). If you can't
  state it crisply, that's the first finding.
- Note whether title/excerpt/content/image are aligned (Q3).
- Note the overall quality: ready to publish, needs a revision
  pass, or needs structural work.

**Issues by category:**

*Must fix* — Factual errors, broken structure, missing sections,
LLM tells, incomplete frontmatter, unclear point (Q1), missing
or generic CTAs (Q2), title/content mismatch (Q3), logical gaps
in the argument (Q4)

*Should fix* — Weak sections, unclear prose, typesetting issues,
tone inconsistencies (Q4), CTAs that could be more specific (Q2),
excerpt that doesn't capture the point (Q3)

*Consider* — Suggestions for strengthening specific sections,
alternative framings, missing opportunities

### Step 5: Present review

Present the review to the author with:
- The core assessment (2-3 sentences)
- The post's point stated back as a single sentence — the author
  can confirm or correct this, which often clarifies everything
- Issues grouped by category (must fix / should fix / consider)
- Specific line references where possible
- For each issue: what's wrong and a concrete suggestion for fixing it

Don't nitpick. Focus on things that materially affect the reader's
experience or the post's effectiveness. The four core questions
take priority over checklist items.

## Comparison with outline

If the original outline is available, also check:
- Does the final post deliver on the intent stated in the outline's
  meta footer?
- Were all planned sections covered?
- Were all assets from the asset checklist included?
- Does the creative angle / ethos element survive the prose-up?
- Any sections that were strong in the outline but weakened in prose?
- Is the point sharper or fuzzier than in the outline?
- Are the CTAs the same ones planned, or did they drift?
