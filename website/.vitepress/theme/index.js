import DefaultTheme, { VPButton } from 'vitepress/theme-without-fonts'
import { enhanceAppWithTabs } from 'vitepress-plugin-tabs/client'

import Layout from './Layout.vue'

import DemoCTAs from '../../src/components/DemoCTAs.vue'
import DemoEmbed from '../../src/components/DemoEmbed.vue'
import DemoListing from '../../src/components/DemoListing.vue'
import HelpWanted from '../../src/components/HelpWanted.vue'
import YoutubeEmbed from '../../src/components/YoutubeEmbed.vue'

import './custom.css'

export default {
  enhanceApp({ app }) {
    app.component('DemoCTAs', DemoCTAs)
    app.component('DemoEmbed', DemoEmbed)
    app.component('DemoListing', DemoListing)
    app.component('HelpWanted', HelpWanted)
    app.component('VPButton', VPButton)
    app.component('YoutubeEmbed', YoutubeEmbed)
    enhanceAppWithTabs(app)
  },
  extends: DefaultTheme,
  Layout: Layout
}
