# Blog Image Brief

Generate a detailed image brief and ChatGPT DALL-E prompt for a blog
post header image. Collaborates with the author to develop visual
metaphors, analyses reference images for style, and produces
ready-to-use generation prompts.

## Process

### Step 1: Gather context

- What is the blog post about? (Read the outline if one exists)
- What is the core argument or thesis?
- What are the key concepts, products, or technologies involved?
- What feeling should the reader get from the image?

### Step 2: Develop visual metaphors

This is the creative core of the brief. The goal is to find a visual
concept that captures the *idea* of the post, not a literal
illustration of the subject matter.

Work iteratively with the author. Ask questions, build on their ideas,
help them think through combinations. Don't generate a list cold —
draw the concepts out of the conversation.

**Questions to explore:**
- What are the 2-3 core concepts this post is about?
- Are there concrete objects or scenes that represent these concepts?
- Is there a relationship between concepts that could be a scene?
- Can brand elements (Electric elephant/lightning bolt, product icons,
  product colours) become characters or objects in the scene?
- Is there a surprising or playful angle?
- What existing header images does the author like? What works about them?

**Examples of good visual metaphors from Electric posts:**
- "Durable sessions for collaborative AI" → robots collaborating to
  wrap a skyscraper in threads (collaboration + enterprise + durability)
- "Super-fast apps on sync" → an electric elephant in a racing car
  by a TanStack palm tree (speed + Electric brand + TanStack brand)

**What makes a good visual metaphor:**
- Captures the *feeling* or *relationship*, not the literal subject
- Works at thumbnail size — the concept is readable even when small
- Surprising or playful enough to catch the eye in a blog listing
- Doesn't require reading the title to make sense as an image
- Makes sense *in combination with* the title — the image is always
  displayed next to the title, so they should work as a pair
- Can incorporate brand elements naturally, not as forced logos

**What to avoid:**
- **Text in the image** — unless 100% required by the concept, there
  must be no text. The title is overlaid by the website layout
- Generic tech imagery (circuit boards, abstract networks, code on
  screens)
- Literal illustrations of the product UI
- Images that only make sense after reading the post
- Overloaded scenes with too many concepts competing

**Goal:** Through conversation, shortlist 3 candidate concepts. Each
described as a one-sentence scene with a note on what it conveys.

### Step 3: Collect reference images

Once the 3 concepts are shortlisted, ask the author for 2-5 reference
images they like the *style* of (separate from concept). These can be:
- Existing Electric blog header images
- Images from other blogs or sites
- Screenshots, photos, illustrations — anything that captures the vibe

For each reference image, analyse and note:
- Colour palette and dominant tones
- Composition style (centered, asymmetric, geometric, organic)
- Level of abstraction (photographic, illustrative, diagrammatic,
  abstract)
- Rendering style (3D rendered, flat illustration, painterly,
  photorealistic, low-poly, isometric)
- Mood (technical, warm, dramatic, minimal, playful)
- Use of lighting and depth
- How well it would crop at different aspect ratios

### Step 4: Synthesise the style direction

Identify common threads across the reference images. Present a summary:

- **Visual style**: e.g. "3D rendered, soft lighting, slightly playful"
- **Colour direction**: e.g. "dark background, purple/cyan accents"
- **Composition**: e.g. "centered subject with breathing room for crop"
- **Mood**: e.g. "technical but not cold, confident, a touch of whimsy"
- **Rendering**: e.g. "clean 3D, not photorealistic — stylised"

Get confirmation or adjustments.

### Step 5: Generate the output

Produce one shared prompt covering technical requirements, style, and
brand context, plus three separate concept variants the author can
each copy-paste into ChatGPT independently.

**Output format:**

```
## Shared prompt (paste this first, then add one concept below)

Create a blog header image, 1536 x 950 pixels, 16:9 aspect ratio.

Style: [Rendering style, level of detail, lighting — from step 4.]

Colour palette: Dark background required. Use these brand colours
as accents:
- #D0BCFF (Electric purple — primary brand)
- #00d2a0 (Electric green)
- #75fbfd (Durable Streams cyan)
- #F6F95C (PGlite yellow)
- #FF8C3B (TanStack DB orange)
[Specific colour direction from step 4.]

Composition: Key content must be centered within the inner 70% of
the frame to survive responsive cropping at different aspect ratios.
Breathing room on all edges. [Specific composition notes.]

Mood: [From step 4.]

CRITICAL: No text in the image unless absolutely required by the
concept. Dark background. The image will be displayed alongside the
post title — they should work as a pair. Keep the upper area
relatively clean as the website may overlay elements. Master as
high-quality JPG.

---

## Concept A: [one-line label]

Concept: [Full scene description — what's in the image, what the
elements represent, how they relate to each other. Be specific
about characters, objects, actions, spatial relationships.]

Brand elements: [Which product mascots, icons, or colour associations
to include and how they appear in the scene.]

---

## Concept B: [one-line label]

Concept: [...]

Brand elements: [...]

---

## Concept C: [one-line label]

Concept: [...]

Brand elements: [...]
```

### Step 6: Iterate

The author generates images from the concepts, comes back with
feedback. Refine the prompt based on what worked and what didn't.

## Brand reference

**Colours:**
- `#D0BCFF` — Electric purple (primary brand, logo)
- `#00d2a0` — Electric green
- `#75fbfd` — Durable Streams cyan
- `#F6F95C` — PGlite yellow
- `#FF8C3B` — TanStack DB orange
- `#7c40ff` — CTA purple

**Assets:**
- Lightning bolt logo: `website/public/img/brand/icon.svg`
- Full logo: `website/public/img/brand/logo.svg`
- Product icons: `website/public/img/icons/`
  - `electric.svg` — Postgres Sync
  - `durable-streams.svg` — Durable Streams
  - `pglite.svg` / `pglite.product.svg` — PGlite
  - `tanstack.svg` — TanStack DB

**Site context:**
- Dark theme forced (always dark mode)
- Font: OpenSauceOne
- Header images served via Netlify image proxy with compression
- OG/social crop: 1200 x 630px center-center fit=cover
- Blog listing: responsive center-center crop

## Image requirements checklist

- [ ] Aspect ratio: 16:9 to 16:10 (~1536 x 950px)
- [ ] High-quality JPG
- [ ] Dark background
- [ ] No text in image (unless 100% required by concept)
- [ ] Key content in inner ~70% frame (survives responsive crop)
- [ ] Works at thumbnail size in blog listing
- [ ] Brand colours used as accents, not overwhelming
- [ ] Saved to `website/public/img/blog/<post-slug>/header.jpg`
