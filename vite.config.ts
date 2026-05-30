import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api-sportsmonks': {
        target: 'https://api.sportmonks.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-sportsmonks/, '')
      },
      '/api-sofascore': {
        target: 'https://api.sofascore.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-sofascore/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('host', 'api.sofascore.app');
            proxyReq.setHeader('origin', 'https://sofascore.app');
            proxyReq.setHeader('referer', 'https://sofascore.app/');
            proxyReq.setHeader('user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1');
            
            // Bypass Cloudflare bot detection by stripping browser-specific headers
            proxyReq.removeHeader('sec-ch-ua');
            proxyReq.removeHeader('sec-ch-ua-mobile');
            proxyReq.removeHeader('sec-ch-ua-platform');
            proxyReq.removeHeader('sec-fetch-site');
            proxyReq.removeHeader('sec-fetch-mode');
            proxyReq.removeHeader('sec-fetch-dest');
          });
        }
      }
    }
  }
})
