import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Read version from root package.json (not client package.json)
const rootPackageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
)
const version = rootPackageJson.version || '1.0.0'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(version)
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true
      },
      '/content': {
        target: 'http://localhost:4000',
        changeOrigin: true
      }
    }
  }
})
