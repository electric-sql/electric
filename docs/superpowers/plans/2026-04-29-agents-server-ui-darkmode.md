# agents-server-ui dark mode — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the editorial/control/workshop font-theme switcher with a sidebar dark-mode toggle, and wire the Electric Agents brand palette into the UI as the canonical theme tokens.

**Architecture:** Add a `DarkModeProvider` (sibling to existing providers) that toggles a `.dark` class on `<html>`. The Radix `<Theme>` reads `darkMode` to flip `appearance` and `accentColor`. Brand palette CSS variables (supplied by the user from the marketing site) live under `:root` (light) and `.dark` (dark); Radix surface tokens and shadcn-style streamdown tokens map to them via `var()` indirection. The sidebar gets a footer row with a Sun/Moon icon button.

**Tech Stack:** React 19, Radix Themes 3.3, lucide-react, vanilla CSS custom properties, vitest (typecheck only — no UI test infra exists in this package).

**Spec:** `docs/superpowers/specs/2026-04-29-agents-server-ui-darkmode-design.md`

---

## File structure

| Action | Path                                                         | Responsibility                                                                                                                                                     |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create | `packages/agents-server-ui/src/hooks/useDarkMode.tsx`        | `DarkModeProvider` context + `useDarkModeContext` hook. Owns localStorage persistence, prefers-color-scheme fallback, and `.dark` class toggling on `<html>`.      |
| Modify | `packages/agents-server-ui/src/App.tsx`                      | Wraps tree in `DarkModeProvider`. Drives Radix `<Theme>` `appearance`/`accentColor` from `darkMode`. Stops importing `ThemeSwitcher`/`useTheme`.                   |
| Modify | `packages/agents-server-ui/src/components/Sidebar.tsx`       | Adds a footer row with a Sun/Moon `IconButton` consuming `useDarkModeContext`.                                                                                     |
| Modify | `packages/agents-server-ui/src/styles.css`                   | Drops `[data-theme='*']` rules. Adds the brand palette under `:root` (light) and `.dark` (dark). Maps Radix surface vars + shadcn streamdown vars to brand tokens. |
| Modify | `packages/agents-server-ui/src/index.ts`                     | Removes `ThemeSwitcher`/`useTheme`/`ThemeId`/`ThemeConfig` exports.                                                                                                |
| Delete | `packages/agents-server-ui/src/components/ThemeSwitcher.tsx` | —                                                                                                                                                                  |

All paths below are relative to repo root unless otherwise noted.

---

## Task 1: Add the dark-mode provider

**Files:**

- Create: `packages/agents-server-ui/src/hooks/useDarkMode.tsx`

This task creates the hook + provider in isolation. Nothing else touches it yet, so it's safe to land independently.

- [ ] **Step 1: Create the file with the provider and hook**

Write `packages/agents-server-ui/src/hooks/useDarkMode.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

const STORAGE_KEY = `electric-agents-ui.dark-mode`

type DarkModeContextValue = {
  darkMode: boolean
  toggleDarkMode: () => void
}

const DarkModeContext = createContext<DarkModeContextValue | null>(null)

function readInitial(): boolean {
  if (typeof window === `undefined`) return false
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === `true`) return true
  if (stored === `false`) return false
  return window.matchMedia?.(`(prefers-color-scheme: dark)`).matches ?? false
}

export function DarkModeProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [darkMode, setDarkMode] = useState<boolean>(readInitial)

  useEffect(() => {
    document.documentElement.classList.toggle(`dark`, darkMode)
  }, [darkMode])

  const toggleDarkMode = useCallback(() => {
    setDarkMode((current) => {
      const next = !current
      window.localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ darkMode, toggleDarkMode }),
    [darkMode, toggleDarkMode]
  )

  return (
    <DarkModeContext.Provider value={value}>
      {children}
    </DarkModeContext.Provider>
  )
}

export function useDarkModeContext(): DarkModeContextValue {
  const value = useContext(DarkModeContext)
  if (!value) {
    throw new Error(`useDarkModeContext must be used inside DarkModeProvider`)
  }
  return value
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @electric-ax/agents-server-ui typecheck`

Expected: passes (this file is not imported anywhere yet, so it should compile in isolation).

- [ ] **Step 3: Commit**

```bash
git add packages/agents-server-ui/src/hooks/useDarkMode.tsx
git commit -m "feat(agents-server-ui): add DarkModeProvider hook

Standalone provider/hook for dark-mode state. Persists to
localStorage, falls back to prefers-color-scheme, and toggles a
.dark class on <html> for CSS to consume."
```

---

## Task 2: Update styles.css with the brand palette

**Files:**

- Modify: `packages/agents-server-ui/src/styles.css`

This task lands the CSS changes before wiring the provider into `App.tsx`. The `.dark` class isn't being toggled yet (`App` still uses `useTheme`), so the visible result is just the _light_ mode getting the new brand palette. That's still useful — verifies the light values render correctly before we add the toggle.

- [ ] **Step 1: Replace the file**

Overwrite `packages/agents-server-ui/src/styles.css` with:

```css
/* Streamdown animation keyframes (fadeIn, blurIn, slideUp) */
@import 'streamdown/styles.css';

/* ── Tokens shared between light + dark ────────────────────────────── */
:root,
.dark {
  /* Legacy aliases — kept so anything still referring to them gets the
     new accent colour. Prefer --vp-c-brand-1 / --durable-streams-color
     in new code. */
  --vp-c-indigo-1: var(--vp-c-brand-1);
  --vp-c-indigo-2: var(--vp-c-brand-2);
  --vp-c-indigo-3: var(--vp-c-brand-3);
  --ddn-color: var(--durable-streams-color);

  --vp-nav-logo-height: 30px;

  --electric-color: #75fbfd;
  --pglite-color: #f6f95c;
  --durable-streams-color: #75fbfd;
  --tanstack-db-color: #ff8c3b;

  --vp-code-font-size: 0.875em;
  --vp-font-family-base:
    OpenSauceOne, ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji',
    'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
  --vp-font-family-mono:
    SourceCodePro, ui-monospace, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;

  /* App-wide font tokens (kept on Inter; brand fonts can be a follow-up) */
  --heading-font: Inter, sans-serif;
  --body-font: Inter, sans-serif;
  --prose-font: var(--body-font);

  /* Streamdown shadcn-style vars — single declaration; resolves
     differently per mode because the brand tokens themselves swap
     between :root and .dark below. */
  --background: var(--vp-c-bg-soft);
  --foreground: var(--vp-c-text-1);
  --card: var(--vp-c-bg-elv);
  --card-foreground: var(--vp-c-text-1);
  --muted: var(--ec-surface-2);
  --muted-foreground: var(--vp-c-text-2);
  --border: var(--ec-border-2);
  --input: var(--ec-border-2);
  --primary: var(--vp-c-brand-1);
  --primary-foreground: var(--vp-button-brand-text);
  --radius: 0.625rem;
}

/* ── Light theme ───────────────────────────────────────────────────── */
:root {
  /* Brand */
  --vp-c-brand-1: #1a1a2e;
  --vp-c-brand-2: #4a4a6a;
  --vp-c-brand-3: #0f0f1e;
  --vp-c-brand-soft: rgba(26, 26, 46, 0.1);

  /* Buttons */
  --vp-button-brand-bg: #1a1a2e;
  --vp-button-brand-hover-bg: #3a3a56;
  --vp-button-brand-active-bg: #0f0f1e;
  --vp-button-brand-border: transparent;
  --vp-button-brand-hover-border: transparent;
  --vp-button-brand-active-border: transparent;
  --vp-button-brand-text: #ffffff;
  --vp-button-brand-hover-text: #ffffff;
  --vp-button-brand-active-text: #ffffff;

  color-scheme: light;

  /* Page surfaces (warm stone) */
  --vp-c-bg: #f7f7f5;
  --vp-c-bg-alt: #f0efed;
  --vp-c-bg-soft: #f0efed;
  --vp-c-bg-elv: #ffffff;
  --vp-c-divider: #e4e3e0;

  /* Text */
  --vp-c-text-1: #1a1a2e;
  --vp-c-text-1-5: rgba(26, 26, 46, 0.86);
  --vp-c-text-2: #5c5c6e;
  --vp-c-text-2-5: rgba(92, 92, 110, 0.85);
  --vp-c-text-3: #999999;

  /* Hero gradient */
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: linear-gradient(135deg, #1a1a2e, #2d2d44);

  /* Code blocks */
  --vp-code-bg: var(--vp-c-bg-elv);
  --vp-code-color: #1a1a2e;

  /* Electric Agents homepage tokens */
  --ea-bg: var(--vp-c-bg);
  --ea-bg-soft: var(--vp-c-bg-soft);
  --ea-surface: var(--vp-c-bg-elv);
  --ea-surface-alt: var(--vp-c-bg-soft);
  --ea-text-1: var(--vp-c-text-1);
  --ea-text-2: var(--vp-c-text-2);
  --ea-text-3: var(--vp-c-text-3);
  --ea-divider: var(--vp-c-divider);
  --ea-brand: #1a1a2e;

  --ea-event-message: #3b82f6;
  --ea-event-run: #8888a0;
  --ea-event-tool-call: #d97706;
  --ea-event-tool-result: #059669;
  --ea-event-text: #1a1a2e;
  --ea-event-error: #dc2626;
  --ea-indicator-sleep: #c4c3c0;
  --ea-indicator-active: #1a1a2e;

  /* Surfaces & borders */
  --ec-surface-1: #f0efed;
  --ec-surface-2: #e8e7e3;
  --ec-surface-3: #dedcd6;
  --ec-border-1: #e6e5e1;
  --ec-border-2: #d6d4ce;
  --ec-overlay-strong: rgba(255, 255, 255, 0.6);
  --ec-overlay-medium: rgba(255, 255, 255, 0.4);
  --ec-overlay-soft: rgba(255, 255, 255, 0.2);

  /* Homepage iso scene */
  --home-iso-sync: #0d9aaa;
  --home-iso-streams: #6f4dff;
  --home-iso-agents: #d44a25;
  --home-iso-neutral: 0, 0, 0;
}

/* ── Dark theme ────────────────────────────────────────────────────── */
.dark {
  /* Brand — accent teal */
  --vp-c-brand-1: #75fbfd;
  --vp-c-brand-2: #b8fdfe;
  --vp-c-brand-3: #56e8ea;
  --vp-c-brand-soft: rgba(117, 251, 253, 0.16);

  /* Buttons */
  --vp-button-brand-bg: #75fbfd;
  --vp-button-brand-hover-bg: #56e8ea;
  --vp-button-brand-active-bg: #3cd5d8;
  --vp-button-brand-border: transparent;
  --vp-button-brand-hover-border: transparent;
  --vp-button-brand-active-border: transparent;
  --vp-button-brand-text: #1a1a1a;
  --vp-button-brand-hover-text: #1a1a1a;
  --vp-button-brand-active-text: #1a1a1a;

  color-scheme: dark;

  /* Page surfaces (deep night) */
  --vp-c-bg: #111318;
  --vp-c-bg-soft: #16181f;
  --vp-c-bg-alt: var(--vp-c-bg-soft);
  --vp-c-bg-elv: #22252f;
  --vp-c-divider: #2a2d38;

  /* Text */
  --vp-c-text-1: rgba(255, 255, 245, 0.92);
  --vp-c-text-1-5: rgba(235, 235, 245, 0.86);
  --vp-c-text-2: rgba(235, 235, 245, 0.8);
  --vp-c-text-2-5: rgba(235, 235, 245, 0.74);
  --vp-c-text-3: rgba(235, 235, 245, 0.68);

  /* Hero gradient */
  --vp-home-hero-name-background: linear-gradient(135deg, #75fbfd, #56e8ea);

  /* Code blocks */
  --vp-code-bg: var(--vp-c-bg-elv);
  --vp-code-color: #9ecbff;

  /* Electric Agents homepage tokens */
  --ea-bg: var(--vp-c-bg);
  --ea-bg-soft: var(--vp-c-bg-soft);
  --ea-surface: var(--ec-surface-1);
  --ea-surface-alt: var(--vp-c-bg-soft);
  --ea-text-1: var(--vp-c-text-1);
  --ea-text-2: var(--vp-c-text-2);
  --ea-text-3: var(--vp-c-text-3);
  --ea-divider: var(--vp-c-divider);
  --ea-brand: var(--vp-c-brand-1);

  --ea-event-message: #60a5fa;
  --ea-event-run: #6b7280;
  --ea-event-tool-call: #fbbf24;
  --ea-event-tool-result: #34d399;
  --ea-event-text: #75fbfd;
  --ea-event-error: #f87171;
  --ea-indicator-sleep: #4a4d58;
  --ea-indicator-active: #75fbfd;

  /* Surfaces & borders */
  --ec-surface-1: #1a1d27;
  --ec-surface-2: #22252f;
  --ec-surface-3: #2d3142;
  --ec-border-1: #22252f;
  --ec-border-2: #2a2d38;
  --ec-overlay-strong: rgba(0, 0, 0, 0.65);
  --ec-overlay-medium: rgba(0, 0, 0, 0.5);
  --ec-overlay-soft: rgba(0, 0, 0, 0.3);

  /* Override VitePress' warm-slate gray family with cool blue-blacks */
  --vp-c-gray-1: #3a3f52;
  --vp-c-gray-2: #2d3142;
  --vp-c-gray-3: #22252f;
  --vp-c-gray-soft: rgba(255, 255, 255, 0.05);

  --vp-c-border: #2a2d38;
  --vp-c-gutter: #0a0b0e;

  /* Homepage iso scene — dark mode */
  --home-iso-sync: #75fbfd;
  --home-iso-streams: #a78bfa;
  --home-iso-agents: #ff8a65;
  --home-iso-neutral: 255, 255, 245;
}

/* ── Radix surface mapping ─────────────────────────────────────────── */
.radix-themes {
  --color-background: var(--vp-c-bg);
  --color-panel-solid: var(--vp-c-bg-elv);
  --default-font-family: var(--body-font);
}

.radix-themes h1,
.radix-themes h2,
.radix-themes h3,
.radix-themes h4,
.radix-themes h5,
.radix-themes h6,
.radix-themes [class*='Heading'] {
  font-family: var(--heading-font);
}

body {
  margin: 0;
  min-height: 100vh;
}

.entity-list-item:hover {
  background: var(--gray-a3);
}

.agent-ui-input:focus {
  border-color: var(--gray-a6);
  background: var(--color-background);
}

/*
 * Streamdown markdown styles using Radix/Capsize type scale.
 * Streamdown's Tailwind classes are inert (no Tailwind loaded) —
 * all styling comes from these element-scoped rules.
 */

/* Root wrapper: flexbox column with gap for spacing */
.agent-ui-markdown > div {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
/* Fallback: if flex gap doesn't apply, use margin between siblings */
.agent-ui-markdown > div > * + * {
  margin-top: var(--space-5);
}

/* --- Body text: size-2 (15.1195px / 23px, trim -0.3968em) --- */
.agent-ui-markdown p,
.agent-ui-markdown li {
  font-size: var(--font-size-2);
  line-height: var(--line-height-2);
  font-family: var(--default-font-family);
  margin: 0;
}
.agent-ui-markdown p::before {
  content: '';
  margin-bottom: -0.3968em;
  display: table;
}
.agent-ui-markdown p::after {
  content: '';
  margin-top: -0.3968em;
  display: table;
}

/* --- h1: size-6, trim -0.1819em --- */
.agent-ui-markdown h1 {
  font-size: var(--font-size-6);
  line-height: var(--heading-line-height-6);
  font-family: var(--heading-font-family);
  font-weight: 600;
  margin: 0;
}
.agent-ui-markdown h1::before {
  content: '';
  margin-bottom: -0.1819em;
  display: table;
}
.agent-ui-markdown h1::after {
  content: '';
  margin-top: -0.1819em;
  display: table;
}

/* --- h2: size-5, trim -0.2425em --- */
.agent-ui-markdown h2 {
  font-size: var(--font-size-5);
  line-height: var(--heading-line-height-5);
  font-family: var(--heading-font-family);
  font-weight: 600;
  margin: 0;
}
.agent-ui-markdown h2::before {
  content: '';
  margin-bottom: -0.2425em;
  display: table;
}
.agent-ui-markdown h2::after {
  content: '';
  margin-top: -0.2425em;
  display: table;
}

/* --- h3: size-4, trim -0.3638em --- */
.agent-ui-markdown h3 {
  font-size: var(--font-size-4);
  line-height: var(--heading-line-height-4);
  font-family: var(--heading-font-family);
  font-weight: 500;
  margin: 0;
}
.agent-ui-markdown h3::before {
  content: '';
  margin-bottom: -0.3638em;
  display: table;
}
.agent-ui-markdown h3::after {
  content: '';
  margin-top: -0.3638em;
  display: table;
}

/* --- h4-h6: size-3, trim -0.3941em --- */
.agent-ui-markdown h4,
.agent-ui-markdown h5,
.agent-ui-markdown h6 {
  font-size: var(--font-size-3);
  line-height: var(--heading-line-height-3);
  font-family: var(--heading-font-family);
  font-weight: 500;
  margin: 0;
}
.agent-ui-markdown h4::before,
.agent-ui-markdown h5::before,
.agent-ui-markdown h6::before {
  content: '';
  margin-bottom: -0.3941em;
  display: table;
}
.agent-ui-markdown h4::after,
.agent-ui-markdown h5::after,
.agent-ui-markdown h6::after {
  content: '';
  margin-top: -0.3941em;
  display: table;
}

/* --- Lists --- */
.agent-ui-markdown ul,
.agent-ui-markdown ol {
  list-style-position: outside;
  padding-left: 1.5em;
  margin: 0;
}
.agent-ui-markdown ul {
  list-style: disc;
}
.agent-ui-markdown ol {
  list-style: decimal;
}
/* Capsize trim on the list CONTAINER only — trims the top of the first
   item and bottom of the last item without interfering with markers. */
.agent-ui-markdown ul::before,
.agent-ui-markdown ol::before {
  content: '';
  margin-bottom: -0.3968em;
  display: table;
}
.agent-ui-markdown ul::after,
.agent-ui-markdown ol::after {
  content: '';
  margin-top: -0.3968em;
  display: table;
}
.agent-ui-markdown li {
  padding: 0;
}
.agent-ui-markdown li > p {
  display: contents;
}
.agent-ui-markdown li > p::before,
.agent-ui-markdown li > p::after {
  content: none;
}
.agent-ui-markdown li::marker {
  font-size: var(--font-size-2);
}

/* --- Code blocks --- */
.agent-ui-markdown pre {
  border-radius: var(--radius);
  background: var(--muted);
  padding: var(--space-3);
  overflow-x: auto;
  margin: 0;
}
.agent-ui-markdown pre code {
  font-family: var(--code-font-family);
  font-size: var(--font-size-1);
  line-height: var(--line-height-1);
  background: none;
  padding: 0;
  border-radius: 0;
}

/* --- Inline code --- */
.agent-ui-markdown code:not(pre code) {
  font-family: var(--code-font-family);
  font-size: 0.9em;
  background: var(--muted);
  padding: 0.1em 0.4em;
  border-radius: calc(var(--radius) * 0.5);
}

/* --- Blockquotes --- */
.agent-ui-markdown blockquote {
  border-left: 4px solid var(--muted-foreground);
  padding-left: var(--space-4);
  color: var(--muted-foreground);
  font-style: italic;
  margin: 0;
}

/* --- Links --- */
.agent-ui-markdown a {
  color: var(--accent-a11);
  text-decoration: underline;
  text-decoration-color: var(--accent-a5);
  text-underline-offset: calc(0.025em + 2px);
  font-weight: 400;
  overflow-wrap: anywhere;
}
.agent-ui-markdown a:hover {
  text-decoration-color: inherit;
}

/* --- Strong / Em --- */
.agent-ui-markdown strong {
  font-weight: 600;
}

/* --- Horizontal rule --- */
.agent-ui-markdown hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 0;
}

/* --- Images --- */
.agent-ui-markdown img {
  max-width: 100%;
  border-radius: var(--radius);
}

/* --- Streamdown code block structure --- */
.agent-ui-markdown
  div.my-4.flex.w-full.flex-col.gap-2.rounded-xl.border.border-border.bg-sidebar.p-2 {
  margin: 0;
}

.agent-ui-markdown [data-streamdown='code-block'] {
  display: flex;
  flex-direction: column;
  border-radius: var(--radius);
  background: var(--muted);
  padding: 4px;
  gap: 2px;
  margin: 0;
  position: relative;
}

.agent-ui-markdown [data-streamdown='code-block-header'] {
  display: flex;
  align-items: center;
  height: 22px;
  padding: 0 40px 0 4px;
  color: var(--muted-foreground);
}

.agent-ui-markdown [data-streamdown='code-block-header'] span {
  display: flex;
  align-items: center;
  height: 100%;
  font-family: var(--code-font-family);
  font-size: 11px;
  line-height: 1;
  text-transform: lowercase;
  margin-left: 0;
}

.agent-ui-markdown
  [data-streamdown='code-block']
  > .pointer-events-none.sticky.top-2.z-10.flex.h-8.items-center.justify-end {
  position: absolute;
  top: 4px;
  right: 4px;
  margin-top: 0;
  height: 22px;
  pointer-events: none;
}

.agent-ui-markdown [data-streamdown='code-block-actions'] {
  position: static;
  display: flex;
  align-items: center;
  gap: 1px;
  background: var(--muted);
  border-radius: 5px;
  padding: 2px;
}

.agent-ui-markdown [data-streamdown='code-block-copy-button'],
.agent-ui-markdown [data-streamdown='code-block-download-button'] {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border: none;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  border-radius: 3px;
  transition:
    color 0.15s,
    background 0.15s;
}

.agent-ui-markdown [data-streamdown='code-block-copy-button'] svg,
.agent-ui-markdown [data-streamdown='code-block-download-button'] svg {
  width: 14px;
  height: 14px;
}

.agent-ui-markdown [data-streamdown='code-block-copy-button']:hover,
.agent-ui-markdown [data-streamdown='code-block-download-button']:hover {
  color: var(--foreground);
  background: var(--border);
}

.agent-ui-markdown [data-streamdown='code-block-body'] {
  overflow-x: auto;
  border-radius: 6px;
  background: var(--background);
  border: 1px solid var(--border);
  padding: var(--space-3) var(--space-4);
}

.agent-ui-markdown [data-streamdown='code-block-body'] pre {
  margin: 0;
  padding: 0;
  background: none;
  border-radius: 0;
}

.agent-ui-markdown [data-streamdown='code-block-body'] code {
  font-family: var(--code-font-family);
  font-size: var(--font-size-1);
  line-height: 1.6;
}

/* Streamdown renders each line as a <span> — make them block-level */
.agent-ui-markdown [data-streamdown='code-block-body'] code > span {
  display: block;
}

/* Streamdown sets --sdm-c via inline style; Tailwind's text-[var(--sdm-c)] is inert */
.agent-ui-markdown [data-streamdown='code-block-body'] code span[style] {
  color: var(--sdm-c, inherit);
  background-color: var(--sdm-tbg, transparent);
}

/* --- Streamdown table structure --- */
.agent-ui-markdown [data-streamdown='table-wrapper'] {
  position: relative;
  overflow-x: auto;
}

.agent-ui-markdown [data-streamdown='table-wrapper'] > div:first-child {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--background);
  border-radius: 6px;
  padding: 2px;
  z-index: 1;
}

.agent-ui-markdown [data-streamdown='table-wrapper'] > div:first-child button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  border-radius: 4px;
  transition:
    color 0.15s,
    background 0.15s;
}

.agent-ui-markdown
  [data-streamdown='table-wrapper']
  > div:first-child
  button:hover {
  color: var(--foreground);
  background: var(--border);
}
```

What changed vs. the old file:

- Dropped the original top-level `:root` block (font tokens + shadcn vars + radius). Folded into the new shared `:root, .dark` block plus the per-mode brand blocks.
- Dropped all three `[data-theme='editorial'|'control'|'workshop']` blocks (selectors and their `.radix-themes` companions).
- Dropped the `[data-theme='workshop'] .agent-ui-markdown p, li, blockquote { font-family: var(--prose-font); }` rule.
- Dropped the `[data-theme] .agent-ui-markdown ::before/::after { display: none !important; }` block.
- Added the brand palette (light under `:root`, dark under `.dark`).
- Added `.radix-themes { --color-background: var(--vp-c-bg); --color-panel-solid: var(--vp-c-bg-elv); --default-font-family: var(--body-font); }`.
- All markdown / capsize rules are unchanged.

- [ ] **Step 2: Typecheck and build to confirm CSS still parses**

Run: `pnpm --filter @electric-ax/agents-server-ui typecheck`

Expected: passes (CSS isn't typechecked, but TS shouldn't have regressed).

Run: `pnpm --filter @electric-ax/agents-server-ui build`

Expected: build succeeds; no CSS parse errors in the output.

- [ ] **Step 3: Commit**

```bash
git add packages/agents-server-ui/src/styles.css
git commit -m "feat(agents-server-ui): wire brand palette into styles.css

Drops the editorial/control/workshop data-theme system and replaces
it with the Electric Agents brand palette (light + dark) under
:root / .dark scopes. Maps Radix surface tokens and shadcn-style
streamdown vars to brand tokens via CSS var indirection."
```

---

## Task 3: Wire DarkModeProvider into App.tsx

**Files:**

- Modify: `packages/agents-server-ui/src/App.tsx`

After this task, the Radix `<Theme>` reads `darkMode` and the `.dark` class is being toggled on `<html>`. The old `ThemeSwitcher` floating button is removed from rendering, but the file itself still exists (deleted in Task 5 to keep the diff small per task).

- [ ] **Step 1: Replace the file**

Overwrite `packages/agents-server-ui/src/App.tsx` with:

```tsx
import { Theme } from '@radix-ui/themes'
import { RouterProvider } from '@tanstack/react-router'
import {
  ServerConnectionProvider,
  useServerConnection,
} from './hooks/useServerConnection'
import { PinnedEntitiesProvider } from './hooks/usePinnedEntities'
import { ElectricAgentsProvider } from './lib/ElectricAgentsProvider'
import { DarkModeProvider, useDarkModeContext } from './hooks/useDarkMode'
import { router } from './router'

function AppInner(): React.ReactElement {
  const { activeServer } = useServerConnection()

  return (
    <ElectricAgentsProvider baseUrl={activeServer?.url ?? null}>
      <PinnedEntitiesProvider>
        <RouterProvider router={router} />
      </PinnedEntitiesProvider>
    </ElectricAgentsProvider>
  )
}

function ThemedApp(): React.ReactElement {
  const { darkMode } = useDarkModeContext()

  return (
    <Theme
      appearance={darkMode ? `dark` : `light`}
      accentColor={darkMode ? `cyan` : `gray`}
      grayColor="slate"
      radius="medium"
      panelBackground="solid"
    >
      <ServerConnectionProvider>
        <AppInner />
      </ServerConnectionProvider>
    </Theme>
  )
}

export function App(): React.ReactElement {
  return (
    <DarkModeProvider>
      <ThemedApp />
    </DarkModeProvider>
  )
}
```

What changed:

- Removed the `ThemeSwitcher` and `useTheme` imports/usage.
- Wrapped the tree in `DarkModeProvider`.
- New `ThemedApp` reads `darkMode` and feeds it to `<Theme>`.
- `accentColor`/`grayColor` are now hardcoded (`gray`/`cyan` flipped on dark, `slate` always for gray).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @electric-ax/agents-server-ui typecheck`

Expected: passes. (`ThemeSwitcher.tsx` still exists and compiles; we just stopped importing it.)

- [ ] **Step 3: Quick build to confirm bundle is intact**

Run: `pnpm --filter @electric-ax/agents-server-ui build`

Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/agents-server-ui/src/App.tsx
git commit -m "feat(agents-server-ui): drive Radix theme from DarkModeProvider

App now wraps in DarkModeProvider and the inner ThemedApp reads
darkMode to set Radix's appearance (light/dark) and accentColor
(gray/cyan). The old ThemeSwitcher is no longer mounted; the file
itself is removed in a follow-up commit."
```

---

## Task 4: Add the dark-mode toggle to the sidebar

**Files:**

- Modify: `packages/agents-server-ui/src/components/Sidebar.tsx`

After this task, the user can toggle dark mode from the sidebar footer.

- [ ] **Step 1: Update the imports**

In `packages/agents-server-ui/src/components/Sidebar.tsx`, change the existing top imports as follows.

Replace this line:

```tsx
import { Flex, Popover, ScrollArea, Text } from '@radix-ui/themes'
```

with:

```tsx
import { Flex, IconButton, Popover, ScrollArea, Text } from '@radix-ui/themes'
```

Replace this line:

```tsx
import { ChevronDown } from 'lucide-react'
```

with:

```tsx
import { ChevronDown, Moon, Sun } from 'lucide-react'
```

Add a new import after the `CodingSessionSpawnDialog` import:

```tsx
import { useDarkModeContext } from '../hooks/useDarkMode'
```

- [ ] **Step 2: Read dark-mode state inside the component**

Inside the `Sidebar` function body, after the existing destructuring of `useElectricAgents`, add:

```tsx
const { darkMode, toggleDarkMode } = useDarkModeContext()
```

So the top of the function looks like:

```tsx
export function Sidebar({
  selectedEntityUrl,
  onSelectEntity,
  pinnedUrls,
}: {
  selectedEntityUrl: string | null
  onSelectEntity: (url: string) => void
  pinnedUrls: Array<string>
}): React.ReactElement {
  const { entitiesCollection, entityTypesCollection, spawnEntity } =
    useElectricAgents()
  const { darkMode, toggleDarkMode } = useDarkModeContext()
  // ... rest unchanged
```

- [ ] **Step 3: Add the footer row**

In the `return` block, find the closing `</ScrollArea>` and insert a new `<Flex>` immediately after it (and immediately before the `{spawnDialogType && (...)}` block).

Find this section:

```tsx
      </ScrollArea>

      {spawnDialogType && (
```

Replace with:

```tsx
      </ScrollArea>

      <Flex
        align="center"
        justify="end"
        px="3"
        py="2"
        style={{
          borderTop: `1px solid var(--gray-a5)`,
          flexShrink: 0,
        }}
      >
        <IconButton
          variant="ghost"
          size="2"
          onClick={toggleDarkMode}
          aria-label={
            darkMode ? `Switch to light mode` : `Switch to dark mode`
          }
        >
          {darkMode ? <Sun size={14} /> : <Moon size={14} />}
        </IconButton>
      </Flex>

      {spawnDialogType && (
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @electric-ax/agents-server-ui typecheck`

Expected: passes.

- [ ] **Step 5: Build**

Run: `pnpm --filter @electric-ax/agents-server-ui build`

Expected: succeeds.

- [ ] **Step 6: Visual verification with dev server**

Run (in a separate terminal): `pnpm --filter @electric-ax/agents-server-ui dev`

Open the URL printed by Vite. Verify:

- The sidebar has a new footer row at the bottom with a single right-aligned icon (Sun if currently dark, Moon if currently light).
- Clicking it flips the appearance: page background, sidebar background, code blocks, popovers, dialogs all update.
- Reload the page — the chosen mode persists.
- Open DevTools, set "prefers-color-scheme" to dark, clear `localStorage`, reload — the app starts in dark mode.

If anything looks off (e.g. unreadable text, mismatched borders), note it; we'll address in Task 6 if needed but the spec's mapping should produce a correct result without further work.

- [ ] **Step 7: Commit**

```bash
git add packages/agents-server-ui/src/components/Sidebar.tsx
git commit -m "feat(agents-server-ui): add dark-mode toggle to sidebar footer

Adds a Sun/Moon IconButton in a new footer row at the bottom of
the sidebar, consuming useDarkModeContext."
```

---

## Task 5: Delete ThemeSwitcher and clean up exports

**Files:**

- Delete: `packages/agents-server-ui/src/components/ThemeSwitcher.tsx`
- Modify: `packages/agents-server-ui/src/index.ts`

This task removes the old code now that nothing references it.

- [ ] **Step 1: Confirm nothing inside the package still imports `ThemeSwitcher`/`useTheme`**

Run:

```bash
grep -rn "ThemeSwitcher\|useTheme\|ThemeId\|ThemeConfig" packages/agents-server-ui/src/ --include="*.ts" --include="*.tsx"
```

Expected output: only matches inside `components/ThemeSwitcher.tsx` and `index.ts`. If anything else still references these symbols, fix that first before continuing.

- [ ] **Step 2: Confirm nothing outside the package imports the removed exports**

Run:

```bash
grep -rn "agents-server-ui.*ThemeSwitcher\|agents-server-ui.*useTheme\|agents-server-ui.*ThemeId\|agents-server-ui.*ThemeConfig" --include="*.ts" --include="*.tsx" /Users/icehaunter/work/electric \
  | grep -v node_modules | grep -v dist/
```

Expected output: empty. (Brainstorm verified this; this is the final guard.)

- [ ] **Step 3: Delete the file**

```bash
rm packages/agents-server-ui/src/components/ThemeSwitcher.tsx
```

- [ ] **Step 4: Update `index.ts`**

In `packages/agents-server-ui/src/index.ts`, remove these two lines:

```ts
export { ThemeSwitcher, useTheme } from './components/ThemeSwitcher'
export type { ThemeId, ThemeConfig } from './components/ThemeSwitcher'
```

The file should now be:

```ts
import './styles.css'

export { App } from './App'

export {
  ServerConnectionProvider,
  useServerConnection,
} from './hooks/useServerConnection'
export {
  ElectricAgentsProvider,
  useElectricAgents,
} from './lib/ElectricAgentsProvider'
export type {
  ElectricEntity,
  ElectricEntityType,
} from './lib/ElectricAgentsProvider'
export { useEntityTimeline } from './hooks/useEntityTimeline'

export { Sidebar } from './components/Sidebar'
export { EntityTimeline } from './components/EntityTimeline'
export { EntityHeader } from './components/EntityHeader'
export { MessageInput } from './components/MessageInput'
export { ServerPicker } from './components/ServerPicker'
export { StatusDot } from './components/StatusDot'

export { getEntityInstanceName } from './lib/types'
export type { ServerConfig, PublicEntity, EntityType } from './lib/types'
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @electric-ax/agents-server-ui typecheck`

Expected: passes.

- [ ] **Step 6: Build**

Run: `pnpm --filter @electric-ax/agents-server-ui build`

Expected: succeeds.

- [ ] **Step 7: Build the workspace package that bundles the UI**

Run: `pnpm --filter @electric-ax/agents-server build`

Expected: succeeds. (The agents-server reads `../../agents-server-ui/dist`, so this catches any consumer-side breakage.)

- [ ] **Step 8: Commit**

```bash
git add packages/agents-server-ui/src/components/ThemeSwitcher.tsx packages/agents-server-ui/src/index.ts
git commit -m "feat(agents-server-ui): remove ThemeSwitcher

The font-theme picker (editorial/control/workshop) is no longer
used. Drop the component and its exports."
```

---

## Task 6: Final visual verification

**Files:** none (verification only).

Smoke-test the full feature end-to-end before declaring it done.

- [ ] **Step 1: Run the dev server**

Run: `pnpm --filter @electric-ax/agents-server-ui dev`

- [ ] **Step 2: Verify each surface in light mode**

In the browser, with the toggle showing the **Moon** icon (= currently light):

- Page background reads as warm stone (`#f7f7f5`), not pure white.
- Sidebar background is slightly darker than the page.
- "New session" button reads as dark navy (`gray-9`-ish), not blue/teal.
- Filter input border + bg blend with the sidebar.
- Open the "New session" dropdown; popover bg is white-ish.
- Spawn an entity with markdown output (or open one); code blocks have a subtle muted bg with the brand text colour.
- Open a coding session; tool calls and messages render with semantic colours from `--ea-event-*`.

- [ ] **Step 3: Toggle to dark mode**

Click the toggle. Verify it now shows the **Sun** icon. Verify:

- Page background is deep navy (`#111318`).
- Sidebar is one step lighter, surfaces ladder from `--ec-surface-1` upward.
- "New session" button is teal (`cyan-9`).
- Code blocks have a darker muted bg, text reads in light brand colour.
- Popovers and dialogs use solid panel bg matching `--vp-c-bg-elv` (`#22252f`).
- Entity timeline event colours (message blue, tool-call amber, tool-result green) all read clearly on dark.

- [ ] **Step 4: Verify persistence**

Reload the page. The mode you ended on should persist.

Clear `localStorage` (DevTools → Application → Local Storage → delete `electric-agents-ui.dark-mode`). Reload. The mode should now match the OS `prefers-color-scheme`.

- [ ] **Step 5: Confirm there are no console errors**

DevTools console should be free of React warnings or 404s for fonts/icons.

- [ ] **Step 6: Stop the dev server**

Ctrl-C the running `pnpm dev` process.

- [ ] **Step 7: Final test + typecheck pass**

Run: `pnpm --filter @electric-ax/agents-server-ui test`

Expected: passes (no UI tests; this exists to make sure no other test in the package was broken by the refactor).

Run: `pnpm --filter @electric-ax/agents-server-ui typecheck`

Expected: passes.

No commit at the end of this task — verification only.

---

## Out of scope

- Adopting brand fonts (`OpenSauceOne` / `SourceCodePro`). The `--vp-font-family-*` tokens are present in the shared `:root, .dark` block but `--body-font`/`--heading-font` stay on Inter; that swap is a follow-up if desired.
- Pre-paint flash mitigation. User explicitly opted out for v1.
- Reskinning `StatusDot.tsx` and `ServerPicker.tsx` connection-state hex colours. Those are semantic indicators, not theme tokens.
