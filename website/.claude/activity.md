# Activity Log

## 2026-01-15

### Task 1.1: Update main navigation structure

**Changes made:**
- Updated `.vitepress/config.mts` to change main navigation structure
- Changed "Product" link to "Sync" pointing to `/sync`
- Added "Products" link pointing to `/products`
- Added "Cloud" link pointing to `/cloud`
- Removed "Use cases" link
- Updated activeMatch patterns for the new navigation items

**Screenshot:** `.claude/screenshots/1.1-update-main-navigation.png`

### Task 1.2: Configure products sidebar

**Changes made:**
- Updated `.vitepress/config.mts` to add new `/products/` sidebar configuration
- Added sidebar items: Overview, Postgres Sync, Durable Streams, TanStack DB, PGlite
- Removed old `/product/` sidebar configuration (it was replaced)
- Created `products/index.md` stub page to test the sidebar

**Screenshot:** `.claude/screenshots/1.2-products-sidebar.png`

## 2026-01-16

### Task 2.1: Create AIThesisSection component

**Changes made:**
- Created `src/components/home/sections/AIThesisSection.vue` with "Build collaborative AI apps" content
- Added AI + collaboration thesis paragraph with emphasized key points (AI, team-based collaboration, fast modern UX)
- Added styled blockquote with the key thesis statement
- Added CTA buttons linking to `/sync` and `/products`
- Exported component from `src/components/home/sections/index.ts`
- Added component to `index.md` for testing (placed after SyncAwesomeSection)

**Screenshot:** `.claude/screenshots/2.1-ai-thesis-section.png`

### Task 2.2: Create SolutionsSection component

**Changes made:**
- Created `src/components/home/sections/SolutionsSection.vue` with 5 outcome-focused panels
- Implemented 3+2 column grid layout (3 cards on top row, 2 centered cards on bottom row)
- Added solution cards: Fast modern apps, Resilient AI apps, Collaborative AI apps, Real-time dashboards, Durable workflows
- Each card links to relevant section on `/sync` page
- Reused existing sync-targets icons (app.svg, agent.svg, dashboard.svg, worker.svg)
- Added "Learn more" and "View products" CTAs
- Exported component from `src/components/home/sections/index.ts`
- Added component to `index.md` for testing (placed after AIThesisSection)

**Screenshot:** `.claude/screenshots/2.2-solutions-section.png`

### Task 2.3: Create ProductsSection component

**Changes made:**
- Created `src/components/home/sections/ProductsSection.vue` with 4 product cards
- Added product cards: Postgres Sync, Durable Streams, TanStack DB, PGlite
- Each card has an icon, title, one-liner description, and links to individual product page
- Implemented 4-column grid layout (2x2 on mobile)
- Added "View all products" CTA linking to `/products`
- Used existing icons: electric.svg, worker.svg, tanstack-social.svg, pglite.svg
- Exported component from `src/components/home/sections/index.ts`
- Added component to `index.md` for testing (placed after SolutionsSection)

**Screenshot:** `.claude/screenshots/2.3-products-section.png`

### Task 2.4: Create DeploymentSection component

**Changes made:**
- Created `src/components/home/sections/DeploymentSection.vue` with three-tier layout
- Added Electric Cloud primary card with prominent CTA (Sign up free) and secondary link (Learn more)
- Added two secondary cards: Open Source (links to /docs/guides/deployment) and Local Development (links to /docs/quickstart)
- Primary cloud card has distinctive styling with gradient background and branded border
- Exported component from `src/components/home/sections/index.ts`
- Added component to `index.md` for testing (placed after ProductsSection)

**Screenshot:** `.claude/screenshots/2.4-deployment-section.png`

### Task 2.5: Update homepage layout

**Changes made:**
- Updated `index.md` to restructure homepage section order
- Removed imports and usage of: PGliteStrap, SyncAwesomeSection, SolvesSyncSection
- Reordered sections to follow new messaging hierarchy:
  1. AIThesisSection
  2. SolutionsSection
  3. ProductsSection
  4. WorksWithSection (moved before DeploymentSection)
  5. DeploymentSection
  6. ScalesToSection
  7. NoSilosStrap
  8. UsedBySection
  9. BackedBySection
  10. OpenSourceSection
  11. LatestNewsSection
  12. GetStartedStrap

**Screenshot:** `.claude/screenshots/2.5-homepage-layout.png`

### Task 2.6: Update hero section

**Changes made:**
- Updated `index.md` hero section with new headline and tagline
- Changed `text` from "solved" to "with your stack" (headline now reads "Sync with your stack")
- Updated tagline to "Composable sync primitives for local-first apps, real-time dashboards, and resilient AI agents."
- Removed duplicate "Sign-up" CTA (kept single "Sign-up to Cloud" brand CTA)
- Kept existing CTAs: Sign-up to Cloud, Quickstart, and GitHub

**Screenshot:** `.claude/screenshots/2.6-hero-section.png`

### Task 2.7: Generalize WorksWithSection

**Changes made:**
- Updated `src/components/home/sections/WorksWithSection.vue` to be broader across all products
- Changed title from "With your existing stack" to "That work with your stack"
- Updated tagline to mention all products: Postgres Sync, TanStack DB, Durable Streams, PGlite
- New tagline describes how products work with Postgres, web frameworks, and any HTTP client
- Updated outline text to "Adopt sync incrementally, one component at a time"
- Maintained visual structure (database/stack/app columns, integration icons grid)

**Screenshot:** `.claude/screenshots/2.7-works-with-section.png`
