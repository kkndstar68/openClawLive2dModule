import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';

export default defineConfig({
  base: './',
  plugins: [
    electron({
      main: {
        entry: 'electron/main.cjs'
      }
    })
  ]
});
