import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
    envPrefix: 'ELECTRIC_',
    plugins: [
        react(),
        svgr({
            svgrOptions: {
                svgo: true,
                plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx'],
                svgoConfig: {
                    plugins: [
                        'preset-default',
                        'removeTitle',
                        'removeDesc',
                        'removeDoctype',
                        'cleanupIds',
                    ],
                },
            },
        }),
    ],
    build: {
        rollupOptions: {
          input: {
            main: resolve(__dirname, 'index.html'),
            // nested: resolve(__dirname, 'nested/index.html'),
          },
        },
    },
});
