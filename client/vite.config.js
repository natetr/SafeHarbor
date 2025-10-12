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
        changeOrigin: true,
        configure: (proxy, _options) => {
          // Global error handler for the proxy
          proxy.on('error', (err, req, res) => {
            console.log('Proxy error:', err.message);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Proxy error' }));
            } else if (!res.writableEnded) {
              res.end();
            }
          });

          // Handle errors on the proxy request
          proxy.on('proxyReq', (proxyReq, req, res) => {
            proxyReq.on('error', (err) => {
              console.log('Proxy request error:', err.message);
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Proxy request error' }));
              } else if (!res.writableEnded) {
                res.end();
              }
            });
          });

          // Handle errors on the proxy response
          proxy.on('proxyRes', (proxyRes, req, res) => {
            // Attach error handler to response stream
            proxyRes.on('error', (err) => {
              console.log('Proxy response stream error:', err.message);
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Proxy response error' }));
              } else if (!res.writableEnded) {
                try {
                  res.end();
                } catch (e) {
                  console.log('Error ending response:', e.message);
                }
              }
            });

            // Also attach error handler to the outgoing response
            res.on('error', (err) => {
              console.log('Client response error:', err.message);
              if (!res.writableEnded) {
                try {
                  res.end();
                } catch (e) {
                  console.log('Error ending response after client error:', e.message);
                }
              }
            });
          });
        }
      },
      '/content': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        configure: (proxy, _options) => {
          proxy.on('error', (err, req, res) => {
            console.log('Proxy error:', err.message);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Proxy error' }));
            } else if (!res.writableEnded) {
              res.end();
            }
          });

          proxy.on('proxyReq', (proxyReq, req, res) => {
            proxyReq.on('error', (err) => {
              console.log('Proxy request error:', err.message);
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Proxy request error' }));
              } else if (!res.writableEnded) {
                res.end();
              }
            });
          });

          proxy.on('proxyRes', (proxyRes, req, res) => {
            proxyRes.on('error', (err) => {
              console.log('Proxy response stream error:', err.message);
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Proxy response error' }));
              } else if (!res.writableEnded) {
                try {
                  res.end();
                } catch (e) {
                  console.log('Error ending response:', e.message);
                }
              }
            });

            res.on('error', (err) => {
              console.log('Client response error:', err.message);
              if (!res.writableEnded) {
                try {
                  res.end();
                } catch (e) {
                  console.log('Error ending response after client error:', e.message);
                }
              }
            });
          });
        }
      }
    }
  }
})
