import Svg, { Path } from 'react-native-svg'

/**
 * Tiny inline SVG icon set — sized like Lucide's stroke icons so they
 * read at parity with the web sidebar. We deliberately avoid pulling
 * in `lucide-react-native` (and the icon CDN font) to keep the embed
 * bundle and the native binary small; if we ever need >10 icons we
 * should reconsider.
 *
 * All paths assume a 24×24 viewBox so the `size` prop scales them
 * uniformly. `color` maps to the SVG `stroke` attribute (Lucide-style
 * icons are stroked, not filled).
 */
export type IconName =
  | `back`
  | `search`
  | `more`
  | `pencil`
  | `check`
  | `chevron-right`
  | `chevron-down`
  | `close`
  | `sun`
  | `moon`
  | `system`
  | `server`
  | `filter`
  | `info`
  | `swap`
  | `chat`
  | `database`

const PATHS: Record<IconName, string> = {
  back: `M15 18l-6-6 6-6`,
  search: `M11 19a8 8 0 1 1 5.3-2L21 21M11 19a8 8 0 0 0 5.3-2`,
  more: `M5 12h.01M12 12h.01M19 12h.01`,
  pencil: `M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z`,
  check: `M5 12l4 4L19 7`,
  'chevron-right': `M9 6l6 6-6 6`,
  'chevron-down': `M6 9l6 6 6-6`,
  close: `M6 6l12 12M6 18L18 6`,
  sun: `M12 4v2M12 18v2M5 5l1.5 1.5M17.5 17.5L19 19M4 12h2M18 12h2M5 19l1.5-1.5M17.5 6.5L19 5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z`,
  moon: `M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z`,
  system: `M4 5h16v11H4zM9 20h6M12 16v4`,
  server: `M5 5h14v6H5zM5 13h14v6H5zM8 8h.01M8 16h.01`,
  filter: `M4 5h16l-6 8v6l-4-2v-4Z`,
  info: `M12 8v.01M11 12h1v4h1M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z`,
  swap: `M7 4l-3 3 3 3M4 7h13M17 14l3 3-3 3M20 17H7`,
  chat: `M4 4h16v12H8l-4 4Z`,
  database: `M5 5c0-1.1 3.1-2 7-2s7 .9 7 2v14c0 1.1-3.1 2-7 2s-7-.9-7-2V5ZM5 12c0 1.1 3.1 2 7 2s7-.9 7-2`,
}

export function Icon({
  name,
  size = 24,
  color,
  strokeWidth = 2,
}: {
  name: IconName
  size?: number
  color: string
  strokeWidth?: number
}): React.ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={PATHS[name]}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  )
}
