import { defineConfig } from 'vite';
import path from 'path';

// Vite config for Lennings / particle-lenia-web
// When repo root is particle-lenia-web, root is '.' and we build play.html
export default defineConfig({
  root: '.',
  base: '/lennings/',
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, 'play.html'),
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
