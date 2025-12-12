import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: "/vnode-editor/",
  build: {
    outDir: 'docs',            // GitHub Pages가 읽을 폴더
  },
  plugins: [react()],
})
