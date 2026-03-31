import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const geckoProxy = {
  '/gecko-terminal-api': {
    target: 'https://api.geckoterminal.com',
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/gecko-terminal-api/, ''),
  },
}

/** Same-origin fetches in dev — metadata hosts often omit Access-Control-Allow-Origin. */
const metadataProxy = {
  '/__md-j7': {
    target: 'https://metadata.j7tracker.com',
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/__md-j7/, ''),
  },
  '/__md-j7-io': {
    target: 'https://metadata.j7tracker.io',
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/__md-j7-io/, ''),
  },
  '/__md-rapidlaunch': {
    target: 'https://metadata.rapidlaunch.io',
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/__md-rapidlaunch/, ''),
  },
  '/__md-drilled': {
    target: 'https://drilled.live',
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/__md-drilled/, ''),
  },
  '/__md-launchblitz': {
    target: 'https://ipfs.launchblitz.ai',
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/__md-launchblitz/, ''),
  },
  '/__md-kimjongnuked': {
    target: 'https://kimjongnuked.com',
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/__md-kimjongnuked/, ''),
  },
  '/__md-extraction': {
    target: 'https://ipfs2.extraction.live',
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/__md-extraction/, ''),
  },
  '/__md-asset-ip': {
    target: 'http://13.222.185.152:4141',
    changeOrigin: true,
    secure: false,
    rewrite: (path) => path.replace(/^\/__md-asset-ip/, ''),
  },
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Pro key  → pro-api.coingecko.com (paid plan, unlocks /onchain OHLCV)
  const coingeckoProKey =
    env.VITE_COINGECKO_PRO_API_KEY?.trim() || env.COINGECKO_PRO_API_KEY?.trim() || ''

  // Demo key → api.coingecko.com  (free plan, ~30 req/min, no /onchain OHLCV)
  // Useful for general CoinGecko endpoints (prices, metadata, etc.) but
  // cannot be used for chart pool-lookup or OHLCV — those require Pro.
  const coingeckoDemoKey =
    env.VITE_COINGECKO_DEMO_API_KEY?.trim() || env.COINGECKO_DEMO_API_KEY?.trim() || ''

  /**
   * Pro API proxy: routes /coingecko-pro-api/* → pro-api.coingecko.com/*
   * and injects x-cg-pro-api-key. Only created when a Pro key is present.
   */
  const coingeckoProProxy = coingeckoProKey
    ? {
        '/coingecko-pro-api': {
          target: 'https://pro-api.coingecko.com',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/coingecko-pro-api/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('x-cg-pro-api-key', coingeckoProKey)
            })
          },
        },
      }
    : {}

  /**
   * Demo API proxy: routes /coingecko-demo-api/* → api.coingecko.com/*
   * and injects x-cg-demo-api-key. Falls back to no proxy if no Demo key.
   */
  const coingeckoDemoProxy = coingeckoDemoKey
    ? {
        '/coingecko-demo-api': {
          target: 'https://api.coingecko.com',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/coingecko-demo-api/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('x-cg-demo-api-key', coingeckoDemoKey)
            })
          },
        },
      }
    : {}

  const devProxy = {
    ...geckoProxy,
    ...metadataProxy,
    ...coingeckoProProxy,
    ...coingeckoDemoProxy,
  }

  return {
    plugins: [react()],
    server: {
      proxy: devProxy,
    },
    preview: {
      proxy: devProxy,
    },
    define: {
      global: 'globalThis',
    },
    resolve: {
      alias: {
        buffer: 'buffer',
      },
    },
    optimizeDeps: {
      include: ['buffer'],
    },
  }
})
