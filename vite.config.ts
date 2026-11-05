import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          const path = id.replaceAll('\\', '/')
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(path)) return 'framework'
          if (/\/node_modules\/(@tiptap\/|prosemirror-)/.test(path)) return 'editor'
          if (/\/node_modules\/(mammoth|@xmldom\/|xmlbuilder|underscore|lop|dingbat-to-unicode)\//.test(path)) return 'word-import'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
})
