import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Player 构建为自包含单文件，供 Host 的 scene.html 能力注入 SceneSpec 后作为产物。
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  server: {
    port: 5174,
  },
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
  },
});
