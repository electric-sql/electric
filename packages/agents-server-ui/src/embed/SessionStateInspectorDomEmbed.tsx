'use dom'

import '../ui/tokens.css'
import '../ui/global.css'
import './SessionDomEmbed.css'
import { installMobileCryptoPolyfill } from './mobileDomRuntime'
import { EmbedStateInspectorRoot, type EmbedSurfaceProps } from './EmbedApp'

installMobileCryptoPolyfill()

if (typeof document !== `undefined`) {
  document.documentElement.setAttribute(`data-electric-mobile-dom`, `true`)
}

export type SessionStateInspectorDomEmbedProps = EmbedSurfaceProps & {
  onRequestOpenEntity: (entityUrl: string) => Promise<void>
  dom?: unknown
}

export default function SessionStateInspectorDomEmbed({
  onRequestOpenEntity,
  ...props
}: SessionStateInspectorDomEmbedProps): React.ReactElement {
  return (
    <EmbedStateInspectorRoot
      {...props}
      onNavigatePathname={(pathname) => {
        const match = /^\/entity(\/.+)$/.exec(pathname)
        const target = match?.[1]
        if (target) return onRequestOpenEntity(target)
      }}
    />
  )
}
