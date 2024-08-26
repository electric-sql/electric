import DefaultTheme, { VPButton } from 'vitepress/theme-without-fonts'
import Layout from './Layout.vue'
import './custom.css'

export default {
  enhanceApp({ app }) {
    app.component('VPButton', VPButton)
  },
  extends: DefaultTheme,
  Layout: Layout
}
