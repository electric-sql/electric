import DefaultTheme, { VPButton } from 'vitepress/theme-without-fonts'
import { enhanceAppWithTabs } from 'vitepress-plugin-tabs/client'
import { defineAsyncComponent } from 'vue'

import Layout from './Layout.vue'

import DemoCTAs from '../../src/components/DemoCTAs.vue'
import DemoEmbed from '../../src/components/DemoEmbed.vue'
import DemoListing from '../../src/components/DemoListing.vue'
import HelpWanted from '../../src/components/HelpWanted.vue'
import HTML5Video from '../../src/components/HTML5Video.vue'
import MarkdownContent from '../../src/components/MarkdownContent.vue'
import MdExportExplicit from '../../src/components/MdExportExplicit.vue'
import MdExportParseHtml from '../../src/components/MdExportParseHtml.vue'
import NavSignupButton from '../../src/components/NavSignupButton.vue'
import YoutubeEmbed from '../../src/components/YoutubeEmbed.vue'

import MegaNav from './components/MegaNav.vue'
import MegaNavMobile from './components/MegaNavMobile.vue'
import MegaNavPanel from './components/MegaNavPanel.vue'
import AgentsSection from '../../src/components/agents-home/Section.vue'

const asyncComponent = (loader) => defineAsyncComponent(loader)

// Route-specific marketing pages and demos are registered globally so
// Markdown can reference them, but loading them synchronously puts every
// page's visuals in the base theme chunk.
const CloudHomePage = asyncComponent(() =>
  import(`../../src/components/cloud-home/CloudHomePage.vue`)
)
const HomePage = asyncComponent(() =>
  import(`../../src/components/home/HomePage.vue`)
)
const SyncHomePage = asyncComponent(() =>
  import(`../../src/components/sync-home/SyncHomePage.vue`)
)
const StreamsHomePage = asyncComponent(() =>
  import(`../../src/components/streams-home/StreamsHomePage.vue`)
)
const BrandToysPage = asyncComponent(() =>
  import(`../../src/components/brand-toys/BrandToysPage.vue`)
)

// OG image cards. Rendered by routes under `/og/*` and captured by
// `scripts/generate-og-images.mjs` to produce the social-card JPGs in
// `public/img/meta/`. Not linked from any nav and excluded from the
// sitemap / llms.txt — they only exist as a screenshot surface.
const OgAgents = asyncComponent(() => import(`../../src/components/og/OgAgents.vue`))
const OgCloud = asyncComponent(() => import(`../../src/components/og/OgCloud.vue`))
const OgHomepage = asyncComponent(() => import(`../../src/components/og/OgHomepage.vue`))
const OgStreams = asyncComponent(() => import(`../../src/components/og/OgStreams.vue`))
const OgSync = asyncComponent(() => import(`../../src/components/og/OgSync.vue`))

// Electric Agents homepage components.
const AgentGridDemo = asyncComponent(() =>
  import(`../../src/components/agents-home/AgentGridDemo.vue`)
)
const AgentsHomePage = asyncComponent(() =>
  import(`../../src/components/agents-home/HomePage.vue`)
)
const ContextCompositionDemo = asyncComponent(() =>
  import(`../../src/components/agents-home/ContextCompositionDemo.vue`)
)
const CoordinationDemo = asyncComponent(() =>
  import(`../../src/components/agents-home/CoordinationDemo.vue`)
)
const CopyPageMarkdown = asyncComponent(() =>
  import(`../../src/components/agents-home/CopyPageMarkdown.vue`)
)
const CrashRecoveryDemo = asyncComponent(() =>
  import(`../../src/components/agents-home/CrashRecoveryDemo.vue`)
)
const EntityNode = asyncComponent(() =>
  import(`../../src/components/agents-home/EntityNode.vue`)
)
const EntityOverviewDiagram = asyncComponent(() =>
  import(`../../src/components/agents-home/EntityOverviewDiagram.vue`)
)
const EntityStreamDemo = asyncComponent(() =>
  import(`../../src/components/agents-home/EntityStreamDemo.vue`)
)
const HeroNetworkBg = asyncComponent(() =>
  import(`../../src/components/agents-home/HeroNetworkBg.vue`)
)
const MessageLine = asyncComponent(() =>
  import(`../../src/components/agents-home/MessageLine.vue`)
)
const StreamViewer = asyncComponent(() =>
  import(`../../src/components/agents-home/StreamViewer.vue`)
)
const SystemMonitorDemo = asyncComponent(() =>
  import(`../../src/components/agents-home/SystemMonitorDemo.vue`)
)

import './custom.css'

export default {
  enhanceApp({ app }) {
    app.component(`CloudHomePage`, CloudHomePage)
    app.component(`DemoCTAs`, DemoCTAs)
    app.component(`DemoEmbed`, DemoEmbed)
    app.component(`DemoListing`, DemoListing)
    app.component(`HelpWanted`, HelpWanted)
    app.component(`HTML5Video`, HTML5Video)
    app.component(`MarkdownContent`, MarkdownContent)
    app.component(`MegaNav`, MegaNav)
    app.component(`MegaNavMobile`, MegaNavMobile)
    app.component(`MegaNavPanel`, MegaNavPanel)
    app.component(`MdExportExplicit`, MdExportExplicit)
    app.component(`MdExportParseHtml`, MdExportParseHtml)
    app.component(`NavSignupButton`, NavSignupButton)
    app.component(`VPButton`, VPButton)
    app.component(`YoutubeEmbed`, YoutubeEmbed)
    // Electric Agents homepage components.
    app.component(`AgentGridDemo`, AgentGridDemo)
    app.component(`AgentsHomePage`, AgentsHomePage)
    app.component(`AgentsSection`, AgentsSection)
    app.component(`ContextCompositionDemo`, ContextCompositionDemo)
    app.component(`CoordinationDemo`, CoordinationDemo)
    app.component(`CopyPageMarkdown`, CopyPageMarkdown)
    app.component(`CrashRecoveryDemo`, CrashRecoveryDemo)
    app.component(`EaSection`, AgentsSection)
    app.component(`EntityNode`, EntityNode)
    app.component(`EntityOverviewDiagram`, EntityOverviewDiagram)
    app.component(`EntityStreamDemo`, EntityStreamDemo)
    app.component(`HeroNetworkBg`, HeroNetworkBg)
    app.component(`HomePage`, HomePage)
    app.component(`MessageLine`, MessageLine)
    app.component(`StreamViewer`, StreamViewer)
    app.component(`SyncHomePage`, SyncHomePage)
    app.component(`StreamsHomePage`, StreamsHomePage)
    app.component(`SystemMonitorDemo`, SystemMonitorDemo)
    app.component(`BrandToysPage`, BrandToysPage)
    // OG image cards.
    app.component(`OgAgents`, OgAgents)
    app.component(`OgCloud`, OgCloud)
    app.component(`OgHomepage`, OgHomepage)
    app.component(`OgStreams`, OgStreams)
    app.component(`OgSync`, OgSync)
    enhanceAppWithTabs(app)
  },
  extends: DefaultTheme,
  Layout: Layout,
}
