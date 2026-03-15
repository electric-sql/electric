# Pyramid Principle

Based on Barbara Minto's Pyramid Principle: Situation, Complication, Question,
Answer, expanded as a MECE pyramid. Adapted for technical blog posts with a
compressed, no-nonsense tone.

## When to use

You have a clear point to make and need to build a logical argument. The reader
should arrive at your conclusion feeling like they reached it themselves.

Good for: technical explanations, "how we built X", opinion pieces with
substance, "why X matters" arguments.

## Reference examples

- [Durable sessions for collaborative AI](https://github.com/electric-sql/electric/blob/main/website/blog/posts/2026-01-12-durable-sessions-for-collaborative-ai.md) — thruflo
- [Bringing agents back down to earth](https://github.com/electric-sql/electric/blob/main/website/blog/posts/2025-08-12-bringing-agents-back-down-to-earth.md) — thruflo
- [Building AI apps on sync](https://github.com/electric-sql/electric/blob/main/website/blog/posts/2025-04-09-building-ai-apps-on-sync.md) — thruflo

## Structure

The outline uses explicit SCQA labels as working structure. The Question is
often edited out or made implicit in the final prose. The Answer bullets
become the `##` headings for the body.

```
[TLDR + info box — standard, see SKILL.md]

Situation:

- Head-nodding statements the reader already believes
- Establish shared reality — no persuasion, just recognition
- 3-5 bullets. If the reader disagrees with any, the post isn't for them
- Every bullet should be so obvious it feels almost boring — that's the point

Complication:

- Introduce tension. Something changed, or something's broken
- The reader should feel "yes, that's my problem"
- This is the hook — if this doesn't land, they stop reading
- Keep it concrete: specific scenarios, not abstractions

Question:

- The question the complication naturally raises
- Stated explicitly in the outline as a working tool
- Often edited to be implicit in the final prose

Answer:

- a — first component of the answer
- b — second component
- c — third component
- These become the ## headings for the body
- Order by importance

## a

- Supporting argument / evidence / detail
- Sub-bullets become ### subsections where needed

### Sub-point of a

- ...

## b

- ...

## c

- ...

***

Next steps:

- CTAs, links, what to do now
```

## Ethos / creative angle

The Situation and Complication should be enhanced with a specific anecdote,
moment, or creative framing drawn from the author during the outline
authoring process. This is not a separate section — it's woven into how
the S and C are expressed.

The logic comes first (establish S and C as bullet points), then the
creative angle refines how they land. The author's personal experience
makes the shared reality vivid and earns the right to make the argument.

Annotate the creative angle inline in the outline:

```
Situation:

- Statement the reader agrees with
- Another shared reality point

<!-- STYLE: Open with [specific anecdote]. This grounds the situation
     in lived experience. The reader should think "this person gets it"
     not "this person is lecturing me." -->

Complication:

- But X is broken / has changed
- The reader recognises this tension
```

## MECE expansion

The Answer bullets expand into the body of the post as a loosely MECE
(mutually exclusive, collectively exhaustive) pyramid:

- Each Answer bullet becomes a `##` section
- Sub-arguments become `###` subsections where warranted
- Each section should stand alone — a reader who skips to one section
  should still get value
- Assess the logic informally: does the expansion hang together and feel
  complete? Are there overlapping sections or obvious gaps?
- This is a blog post, not a PhD thesis — the logic should be sound
  but don't nitpick mutual exclusivity

## Tone guidance

- Situation bullets should be matter-of-fact, confident, no persuasion yet
- Complication should make the reader lean in — emotional, not just logical
- Answer should be direct and clear — state the thesis, don't hedge
- Expansion sections: show, don't tell. Code, examples, evidence
- Bullets are compressed meaning — expand each into 1-2 sentences with
  minimal rewording. The compression often produces fresh prose naturally

## Evaluation criteria

- Does the situation establish genuine shared reality or is it hand-waving?
- Does the complication create real tension or is it manufactured?
- Does the answer actually resolve the complication?
- Do the expansion sections follow logically from the answer bullets?
- Would the reader reach the same conclusion if they followed the logic?
- Is the ethos / creative angle woven in or missing?
