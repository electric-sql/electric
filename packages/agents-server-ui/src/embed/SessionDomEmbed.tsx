'use dom'

import '../ui/tokens.css'
import '../ui/global.css'
import './SessionDomEmbed.css'
import { installMobileCryptoPolyfill } from './mobileDomRuntime'
import { EmbedSessionRoot, type EmbedSessionProps } from './EmbedApp'

installMobileCryptoPolyfill()

if (typeof document !== `undefined`) {
  document.documentElement.setAttribute(`data-electric-mobile-dom`, `true`)
}

export type SessionDomEmbedProps = Omit<
  EmbedSessionProps,
  `onNavigatePathname`
> & {
  onRequestOpenEntity: (entityUrl: string) => Promise<void>
  // Expo injects this prop for DOM Components. Keep it untyped here so
  // agents-server-ui does not need to depend on Expo just to typecheck
  // its regular web/desktop builds.
  dom?: unknown
}

/**
 * Expo DOM Components entrypoint consumed by `packages/agents-mobile`.
 *
 * This keeps web-only dependencies, CSS Modules and TanStack DB instances
 * inside `agents-server-ui` instead of re-importing them from the native
 * mobile package.
 */
export default function SessionDomEmbed({
  onRequestOpenEntity,
  ...props
}: SessionDomEmbedProps): React.ReactElement {
  return (
    <EmbedSessionRoot
      {...props}
      onNavigatePathname={(pathname) => {
        const match = /^\/entity(\/.+)$/.exec(pathname)
        const target = match?.[1]
        if (target) return onRequestOpenEntity(target)
      }}
    />
  )
}
