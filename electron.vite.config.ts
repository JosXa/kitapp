import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { BuildOptions } from 'vite';
import { fileURLToPath } from 'url';

const build: BuildOptions = {
  rollupOptions: {
    output: {
      format: 'es',
    },
  },
};
const config = defineConfig({
  main: {
    build,
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build,
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    server: {
      port: 4444,
      fs: {
        allow: ['../../src', '../../node_modules/@fontsource'],
      },
    },
    build: {
      rollupOptions: {
        ...build.rollupOptions,
        input: {
          main: resolve('src/renderer/index.html'),
          widget: resolve('src/renderer/widget.html'),
        },
      },
    },
    resolve: {
      alias: {
        'electron/main': 'electron',
        'electron/common': 'electron',
        'electron/renderer': 'electron',

        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react()],
  },
});

// console.log({ config: JSON.stringify(config, null, 2) });

export default config;