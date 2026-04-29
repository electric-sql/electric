# agents-server-ui dark mode — design

## Goals

1. Remove the existing `ThemeSwitcher` (font-theme picker for editorial/control/workshop) entirely.
2. Add a sidebar dark-mode toggle.
3. Wire the Electric Agents brand palette (light + dark, supplied by user) into the UI as the canonical theme tokens.
4. Configure Radix Themes globally rather than per-data-theme.

## Non-goals

- Adopt the brand's `OpenSauceOne` / `SourceCodePro` fonts. Stays Inter for now; can be a follow-up.
- Reskin status/connection indicator hex colors. Those are semantic state colors, not theme tokens.
- Re-style every component to use brand-specific tokens. Components that already use Radix CSS variables (`--gray-*`, `--accent-*`, `--color-background`) adapt for free once `appearance` flips and the surface vars are mapped.

## Files

| Action | Path                                                         |
| ------ | ------------------------------------------------------------ |
| Delete | `packages/agents-server-ui/src/components/ThemeSwitcher.tsx` |
| Add    | `packages/agents-server-ui/src/hooks/useDarkMode.ts`         |
| Modify | `packages/agents-server-ui/src/App.tsx`                      |
| Modify | `packages/agents-server-ui/src/components/Sidebar.tsx`       |
| Modify | `packages/agents-server-ui/src/styles.css`                   |
| Modify | `packages/agents-server-ui/src/index.ts`                     |

## Theme configuration

Radix `<Theme>` is configured once in `App.tsx`:

```tsx
<Theme
  appearance={darkMode ? 'dark' : 'light'}
  accentColor={darkMode ? 'cyan' : 'gray'}
  grayColor="slate"
  radius="medium"
  panelBackground="solid"
>
```

Rationale (option B from brainstorm):

- `appearance` flips Radix's built-in scales between light and dark.
- The brand uses different accents per mode — navy `#1a1a2e` in light, teal `#75fbfd` in dark. Radix's `accentColor` is a single prop, so we drive it from `darkMode`. `cyan` is the closest preset to brand teal in dark; `gray` in light pulls primary actions into the navy ink range.
- `grayColor="slate"` is a cool gray that blends with the deep-night surface palette.
- `panelBackground="solid"` ensures popovers/menus use a solid bg matching `--color-panel-solid`.

## Dark-mode hook (`useDarkMode.ts`)

```ts
const STORAGE_KEY = 'electric-agents-ui.dark-mode'

export function useDarkMode(): {
  darkMode: boolean
  toggleDarkMode: () => void
} {
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'true') return true
    if (stored === 'false') return false
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

  const toggleDarkMode = useCallback(() => {
    setDarkMode((v) => {
      const next = !v
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  return { darkMode, toggleDarkMode }
}
```

Behaviour:

- First render: read `localStorage`; fall back to `prefers-color-scheme`.
- Toggle: persist + flip the `.dark` class on `<html>`. The user's brand CSS scopes its dark tokens to `:root, .dark`, so toggling that class switches the whole token set in one place.

## `styles.css`

1. Drop the three `[data-theme='editorial'|'control'|'workshop']` blocks.
2. Drop the `[data-theme] .agent-ui-markdown ::before/::after { display: none }` overrides — those existed only to disable Inter-specific capsize trims under non-Inter themes; with a single Inter default they're not needed.
3. Add the user's full brand palette verbatim:
   - Shared tokens under `:root, .dark`
   - Light tokens under `:root`
   - Dark tokens under `.dark`
4. Wire Radix surface vars to brand tokens, scoped to `.radix-themes`:
   ```css
   .radix-themes {
     --color-background: var(--vp-c-bg);
     --color-panel-solid: var(--vp-c-bg-elv);
   }
   ```
5. Define the shadcn-style streamdown vars (`--background`, `--foreground`, `--muted`, `--muted-foreground`, `--border`, `--input`, `--card`, `--card-foreground`, `--primary`, `--primary-foreground`) once under `:root, .dark` (or just `:root` — they cascade either way) with `var(--brand-token)` references. Brand tokens themselves swap between `:root` and `.dark`, so the shadcn vars resolve to the right values automatically. Mapping:
   - `--background: var(--vp-c-bg-soft)`
   - `--foreground: var(--vp-c-text-1)`
   - `--muted: var(--ec-surface-2)`
   - `--muted-foreground: var(--vp-c-text-2)`
   - `--border: var(--ec-border-2)`
   - `--input: var(--ec-border-2)`
   - `--card: var(--vp-c-bg-elv)`
   - `--card-foreground: var(--vp-c-text-1)`
   - `--primary: var(--vp-c-brand-1)`
   - `--primary-foreground: var(--vp-button-brand-text)`
6. Keep the `:root` font tokens (Inter) and all markdown/capsize rules as-is.

## `Sidebar.tsx`

`Sidebar` consumes `useDarkModeContext()` directly — no new props on its public signature. After the existing `<ScrollArea>`, before the `<SpawnArgsDialog>`/`<CodingSessionSpawnDialog>` mounts, add a footer:

```tsx
const { darkMode, toggleDarkMode } = useDarkModeContext()
// ...
<Flex
  align="center"
  justify="end"
  px="3"
  py="2"
  style={{ borderTop: `1px solid var(--gray-a5)`, flexShrink: 0 }}
>
  <IconButton
    variant="ghost"
    size="2"
    onClick={toggleDarkMode}
    aria-label={darkMode ? `Switch to light mode` : `Switch to dark mode`}
  >
    {darkMode ? <Sun size={14} /> : <Moon size={14} />}
  </IconButton>
</Flex>
```

Imports already include `Flex` and `lucide-react`; add `IconButton` from `@radix-ui/themes` and `Sun`/`Moon` from `lucide-react`.

## `App.tsx`

Replace the `useTheme` import + usage. Pass `darkMode`/`toggleDarkMode` to wherever the sidebar is rendered. Looking at the current flow, `App` doesn't render `Sidebar` directly — the router does. Two options:

1. Lift dark-mode state to a small `DarkModeContext` so `Sidebar` (rendered inside the router) can consume it without prop drilling. Same pattern as `ServerConnectionProvider` and `PinnedEntitiesProvider`.
2. Prop-drill from `App` through `RouterProvider` context.

Pick **option 1** (`DarkModeProvider` + `useDarkModeContext`). It matches the existing provider pattern and keeps the `Sidebar` independently testable.

`App.tsx` becomes:

```tsx
function ThemedApp(): React.ReactElement {
  const { darkMode } = useDarkModeContext()
  return (
    <Theme
      appearance={darkMode ? 'dark' : 'light'}
      accentColor={darkMode ? 'cyan' : 'gray'}
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

`Sidebar` consumes `useDarkModeContext()` directly for the toggle button; no new props needed in any router-provided wrapper.

## `index.ts`

Drop the `ThemeSwitcher` exports:

```ts
// remove:
export { ThemeSwitcher, useTheme } from './components/ThemeSwitcher'
export type { ThemeId, ThemeConfig } from './components/ThemeSwitcher'
```

(If anything outside the package imports these, that'll surface as a build error and we'll fix it. A grep across the workspace will confirm before deletion.)

## Risks / things to verify in implementation

1. **Cross-package consumers** — verified during brainstorm: no consumers outside `packages/agents-server-ui/src/` (`examples/burn` has its own unrelated `ThemeProvider`; `agents-chat-starter` doesn't import the switcher). Safe to delete the exports.
2. **Pre-paint flash** — the hook sets `.dark` in a `useEffect`, so on first paint the class is missing. If FOUC is noticeable, hoist a small inline script in `index.html` that sets the class synchronously before React boots. Out of scope unless visible.
3. **Streamdown shadcn vars** — verify code blocks render correctly in dark mode after the brand-token mapping; streamdown is the most likely place for hardcoded light-mode assumptions to leak.
4. **Radix accent flip** — confirm `<Theme>` re-renders cleanly when `accentColor` changes (it should — it's a top-level prop).
5. **`<meta name="color-scheme">`** — leave as `light dark`. Lets the browser pick form-control/scrollbar styling consistently before our class lands.

## Test plan

- Toggle dark mode via the new button; verify all surfaces flip (sidebar, entity list, message input, code blocks, popovers, dialogs, scrollbar).
- Verify localStorage persists across reload.
- Clear localStorage and toggle OS dark mode; first load should follow the system.
- Visually compare against the brand site palette spec the user supplied: page bg, surface ladder, brand button, text scales.
