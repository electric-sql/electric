import DefaultTheme, { VPButton } from 'vitepress/theme-without-fonts'
import { enhanceAppWithTabs } from 'vitepress-plugin-tabs/client'
import YoutubeEmbed from '../../src/components/YoutubeEmbed.vue'
import Layout from './Layout.vue'
import './custom.css'

export default {
  enhanceApp({ app }) {
    app.component('VPButton', VPButton)
    app.component('YoutubeEmbed', YoutubeEmbed)
    enhanceAppWithTabs(app)
  },
  extends: DefaultTheme,
  Layout: Layout
}
