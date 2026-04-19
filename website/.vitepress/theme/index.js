import DefaultTheme, { VPButton } from 'vitepress/theme-without-fonts'
import { enhanceAppWithTabs } from 'vitepress-plugin-tabs/client'

import Layout from './Layout.vue'

import DemoCTAs from '../../src/components/DemoCTAs.vue'
import DemoEmbed from '../../src/components/DemoEmbed.vue'
import DemoListing from '../../src/components/DemoListing.vue'
import HelpWanted from '../../src/components/HelpWanted.vue'
import HTML5Video from '../../src/components/HTML5Video.vue'
import NavSignupButton from '../../src/components/NavSignupButton.vue'
import YoutubeEmbed from '../../src/components/YoutubeEmbed.vue'

import MegaNav from './components/MegaNav.vue'
import MegaNavMobile from './components/MegaNavMobile.vue'
import MegaNavPanel from './components/MegaNavPanel.vue'

// Electric Agents homepage (ported from darix-docs).
import AgentGridDemo from './components/agents-home/AgentGridDemo.vue'
import AgentsHomePage from './components/agents-home/HomePage.vue'
import AgentsSection from './components/agents-home/Section.vue'
import ContextCompositionDemo from './components/agents-home/ContextCompositionDemo.vue'
import CoordinationDemo from './components/agents-home/CoordinationDemo.vue'
import CopyPageMarkdown from './components/agents-home/CopyPageMarkdown.vue'
import CrashRecoveryDemo from './components/agents-home/CrashRecoveryDemo.vue'
import EntityNode from './components/agents-home/EntityNode.vue'
import EntityOverviewDiagram from './components/agents-home/EntityOverviewDiagram.vue'
import EntityStreamDemo from './components/agents-home/EntityStreamDemo.vue'
import HeroNetworkBg from './components/agents-home/HeroNetworkBg.vue'
import MessageLine from './components/agents-home/MessageLine.vue'
import StreamViewer from './components/agents-home/StreamViewer.vue'
import SystemMonitorDemo from './components/agents-home/SystemMonitorDemo.vue'

import './custom.css'

export default {
  enhanceApp({ app }) {
    app.component(`DemoCTAs`, DemoCTAs)
    app.component(`DemoEmbed`, DemoEmbed)
    app.component(`DemoListing`, DemoListing)
    app.component(`HelpWanted`, HelpWanted)
    app.component(`HTML5Video`, HTML5Video)
    app.component(`MegaNav`, MegaNav)
    app.component(`MegaNavMobile`, MegaNavMobile)
    app.component(`MegaNavPanel`, MegaNavPanel)
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
    app.component(`MessageLine`, MessageLine)
    app.component(`StreamViewer`, StreamViewer)
    app.component(`SystemMonitorDemo`, SystemMonitorDemo)
    enhanceAppWithTabs(app)
  },
  extends: DefaultTheme,
  Layout: Layout,
}
