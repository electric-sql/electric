import * as path from 'path'
import { defineConfig } from 'vite'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import react from '@vitejs/plugin-react'

const TOOLBAR_TEMPALTE_ID = '__electric_debug_toolbar_template'

export default defineConfig({
  plugins: [
    react(),
    cssInjectedByJsPlugin({
      // add styles as web template to use inside shadow dom
      injectCode: (cssCode: string) => {
        return `
        try{
          if(typeof document != 'undefined'){
            var template = document.createElement('template');
            template.id = '${TOOLBAR_TEMPALTE_ID}';
            var elementStyle = document.createElement('style');
            elementStyle.appendChild(document.createTextNode(${cssCode}));
            template.content.appendChild(elementStyle);
            document.head.appendChild(template);
          }
        }catch(e){console.error('vite-plugin-css-injected-by-js', e);}`
      },
    }),
  ],
  build: {
    sourcemap: true,
    minify: true,
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: path.resolve(__dirname, 'src/index.tsx'),
      name: '@electric-sql/debug-toolbar',
      // the proper extensions will be added
      fileName: 'index',
    },
    rollupOptions: {
      onLog: (level, log, handler) => {
        if (
          log.code === 'INVALID_ANNOTATION' &&
          log.message.includes('/*#__PURE__*/')
        ) {
          // ignore these, not critical but fails build
          // https://github.com/vitejs/vite/issues/15100
          return
        }
        handler(level, log)
      },
    },
  },
})
