We are restructuring the Electric website and brining in the content from `/Users/samwillis/Code/darix/darix-docs` and `/Users/samwillis/Code/durable-streams/docs`

The idea is that we have three product virticals:

- Agents "Electric Agents" - this is the stuff from Users/samwillis/Code/darix/darix-docs`
- Streams "Durable Streams" - this is the stuff from /Users/samwillis/Code/durable-streams/docs
- Sync "Electric Sync" - This is the current sync engine and Tanstack DB (with PGlite as a secondary lower priority aside)

Starting from the top nav:

- We drop the social and product icons
- the Nav is structured as:
  - Agents
  - Streams
  - Sync
    // divider
  - Cloud
  - Pricing
    //
  - Resources

Each of sync, streams, agents, resources is a vercel site like popdown menu (shown on hover, or click on mobile) with links for each of those sections:

- Home (or similar, this is the landing page with goor motion graphics and thigns)
- Overview - wordy dectription in the docs
- Quick start
- Demos
- docs ....
- ...

The resources one has the company, legal, social, community, and other stuff.

The url structure we go (with agents as an example):

/agents -> landing page
/agents/demos -> demos page
/docs/agents -> docs page
/docs/agents/quickstart -> quickstart page
/docs/agents/... -> other docs pages

This first session is concetrating on the navigation and structure. We can move content in, and create the new landing pages later.

For the sync content, use the current content.

We need to ensure that there are redirect set up for all the old content to the new content.

====

Where should the existing /docs/agents (AGENTS.md / LLM instructions page) move to?

unsure - this needs consideration. PLace where you think best for now
Move all current sync docs under /docs/sync/...?

Yes — move everything (intro, quickstart, guides, api, integrations, reference) under /docs/sync/\* with 301 redirects
How should demos be structured?

Per-product only: /sync/demos, /agents/demos, /streams/demos. Drop unified /demos.
Where should PGlite live in the new IA?

Under Resources as a separate primitive link
What should the Resources popdown contain? (multi-select)

Blog, Primitives index, Community, Team / About, Jobs, Contact, Discord link, GitHub link, X / Twitter link, LLMs / AGENTS.md page
The top-nav currently has icons (durable-streams, tanstack, pglite, x, discord, github). Drop them all?

Drop all — they live inside Resources / footer
Build the popdown menus how?

Build a custom Vercel-style hover/click mega-menu component now
What should I actually do in this session?

Build nav/structure with stub pages + redirects only; defer content copy to later
Redirects scope?

Add electric-sql.com redirects now; document required external-domain redirects in a TODO/notes file
