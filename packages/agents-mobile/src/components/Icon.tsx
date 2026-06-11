import Svg, { Circle, Path } from 'react-native-svg'

/**
 * Tiny inline SVG icon set — sized like Lucide's stroke icons so they
 * read at parity with the web sidebar. We deliberately avoid pulling
 * in `lucide-react-native` (and the icon CDN font) to keep the embed
 * bundle and the native binary small; if we ever need >10 icons we
 * should reconsider.
 *
 * All paths assume a 24×24 viewBox so the `size` prop scales them
 * uniformly. `color` maps to the SVG `stroke` attribute for Lucide-style
 * icons; the overflow menu uses filled dots so it stays readable at nav-bar
 * size.
 */
export type IconName =
  | `back`
  | `search`
  | `more`
  | `pencil`
  | `check`
  | `chevron-right`
  | `chevron-down`
  | `chevron-up`
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
  | `radio`
  | `arrow-up`
  | `square`
  | `github`
  | `google`
  | `cloud`
  | `user`
  | `users`
  | `pin`
  | `image`
  | `camera`

const PATHS: Record<IconName, string> = {
  back: `M15 18l-6-6 6-6`,
  search: `M11 19a8 8 0 1 1 5.3-2L21 21M11 19a8 8 0 0 0 5.3-2`,
  more: `M5 12h.01M12 12h.01M19 12h.01`,
  pencil: `M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z`,
  check: `M5 12l4 4L19 7`,
  'chevron-right': `M9 6l6 6-6 6`,
  'chevron-down': `M6 9l6 6 6-6`,
  'chevron-up': `M6 15l6-6 6 6`,
  close: `M6 6l12 12M6 18L18 6`,
  sun: `M12 4v2M12 18v2M5 5l1.5 1.5M17.5 17.5L19 19M4 12h2M18 12h2M5 19l1.5-1.5M17.5 6.5L19 5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z`,
  moon: `M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z`,
  system: `M4 5h16v11H4zM9 20h6M12 16v4`,
  server: `M5 5h14v6H5zM5 13h14v6H5zM8 8h.01M8 16h.01`,
  cloud: `M17.5 19a4.5 4.5 0 1 0-1.4-8.78A6 6 0 1 0 6 16.66 4 4 0 0 0 7 19h10.5Z`,
  user: `M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 21a7 7 0 0 1 14 0`,
  users: `M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3.13a4 4 0 0 1 0 7.74M22 21v-2a4 4 0 0 0-3-3.87M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z`,
  filter: `M4 5h16l-6 8v6l-4-2v-4Z`,
  info: `M12 8v.01M11 12h1v4h1M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z`,
  swap: `M7 4l-3 3 3 3M4 7h13M17 14l3 3-3 3M20 17H7`,
  chat: `M4 4h16v12H8l-4 4Z`,
  database: `M5 5c0-1.1 3.1-2 7-2s7 .9 7 2v14c0 1.1-3.1 2-7 2s-7-.9-7-2V5ZM5 12c0 1.1 3.1 2 7 2s7-.9 7-2`,
  radio: `M4.9 19.1a10 10 0 0 1 0-14.2M7.8 16.2a6 6 0 0 1 0-8.4M10.6 13.4a2 2 0 0 1 0-2.8M14 12h.01M16.2 7.8a6 6 0 0 1 0 8.4M19.1 4.9a10 10 0 0 1 0 14.2`,
  'arrow-up': `M12 19V5M5 12l7-7 7 7`,
  // Lucide `pin` — matches the desktop sidebar's pin toggle glyph.
  pin: `M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z`,
  square: `M7 7h10v10H7z`,
  // Lucide `image` / `camera` — image attachment affordances.
  image: `M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM21 15l-5-5L5 21`,
  camera: `M9 4 7.5 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2.5L15 4ZM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z`,
  github: `M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4M9 18c-4.51 2-5-2-7-2`,
  // Official Google "G" mark, rendered in a single fill colour. Google's
  // brand guidelines permit monochrome use in CTA contexts where the
  // multi-colour mark would clash with the surrounding palette.
  google: `M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09zM12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23zM5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62zM12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z`,
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
  if (name === `more`) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx={5} cy={12} r={1.7} fill={color} />
        <Circle cx={12} cy={12} r={1.7} fill={color} />
        <Circle cx={19} cy={12} r={1.7} fill={color} />
      </Svg>
    )
  }

  if (name === `square` || name === `google`) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d={PATHS[name]} fill={color} />
      </Svg>
    )
  }

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
