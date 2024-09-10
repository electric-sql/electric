import DefaultTheme, { VPButton } from 'vitepress/theme-without-fonts'
import Layout from './Layout.vue'
import YoutubeEmbed from '../../src/components/YoutubeEmbed.vue'
import './custom.css'

export default {
  enhanceApp({ app }) {
    app.component('VPButton', VPButton)
    app.component('YoutubeEmbed', YoutubeEmbed)
  },
  extends: DefaultTheme,
  Layout: Layout
}
