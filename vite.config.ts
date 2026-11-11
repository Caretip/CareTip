import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/** Normalize BASE_URL / *_APP_URL values into `https://host` (no path). Used only at config time. */
function publicSiteOriginFromEnvValue(raw: string | undefined): string {
  if (typeof raw !== 'string') return ''
  let s = raw.replace(/^\uFEFF/, '').trim().replace(/\uFF1D/g, '=').replace(/\/+$/, '')
  if (!s) return ''
  for (let i = 0; i < 6; i++) {
    const before = s
    s = s.replace(/^VITE_APP_URL=/i, '').replace(/^NEXT_PUBLIC_APP_URL=/i, '').trim().replace(/\/+$/, '')
    if (s === before) break
  }
  if (!/^https?:\/\//i.test(s)) {
    const m = s.match(/https?:\/\/[^\s"'`]+/i)
    if (m) s = m[0].trim().replace(/\/+$/, '')
    else if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/i.test(s)) s = `https://${s}`
  }
  if (!/^https?:\/\//i.test(s)) return ''
  try {
    return new URL(s).origin.replace(/\/+$/, '')
  } catch {
    const hostOnly = s.match(/^https?:\/\/[^/]+/i)
    return hostOnly ? hostOnly[0].replace(/\/+$/, '') : ''
  }
}

/** Tells theme-init.js which files to start early, since their hashed names are only known here. */
function bootAssetsMetaPlugin() {
  return {
    name: 'caretip-boot-assets-meta',
    transformIndexHtml: {
      order: 'post' as const,
      handler(_html: string, ctx: { bundle?: Record<string, { fileName: string; facadeModuleId?: string | null }> }) {
        const assets: Record<string, string> = {};
        for (const { fileName, facadeModuleId } of Object.values(ctx.bundle ?? {})) {
          const locale = /\/i18n\/locales\/(de|en)\.json/.exec(facadeModuleId ?? '');
          if (locale) assets[locale[1]!] = `/${fileName}`;
          if (/^assets\/landing-[\w-]+\.css$/.test(fileName)) assets.landingCss = `/${fileName}`;
        }
        if (!Object.keys(assets).length) return [];
        return [
          {
            tag: 'meta',
            attrs: { name: 'caretip-boot-assets', content: JSON.stringify(assets) },
            injectTo: 'head-prepend' as const,
          },
        ];
      },
    },
  };
}

/**
 * Dev/preview proxy: when the backend on :3001 is not listening (starting, restarting, crashed),
 * Vite answers an empty 500, which the app reads as a server bug ("Something went wrong").
 * Answer 503 instead so the client classifies it as connectivity and keeps the session.
 * Vite still logs the proxy error in the terminal.
 */
function apiProxyUnreachableAs503(proxy: { on: (event: 'error', cb: (err: Error, req: unknown, res: unknown) => void) => void }) {
  proxy.on('error', (_err, _req, res) => {
    const out = res as { headersSent?: boolean; writableEnded?: boolean; writeHead?: (s: number, h: Record<string, string>) => { end: (b: string) => void } } | undefined
    if (!out || typeof out.writeHead !== 'function' || out.headersSent || out.writableEnded) return
    out
      .writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '2' })
      .end(JSON.stringify({ message: 'Service temporarily unavailable', code: 'API_UNREACHABLE' }))
  })
}

export default defineConfig(({ mode }) => {
  const repoRoot = fileURLToPath(new URL('.', import.meta.url))
  const loaded = loadEnv(mode, repoRoot, '')
  const injectedOrigin = publicSiteOriginFromEnvValue(
    loaded.BASE_URL || loaded.VITE_BASE_URL || loaded.NEXT_PUBLIC_APP_URL || loaded.VITE_APP_URL,
  )

  return {
  /** Required for correct asset URLs on Vercel and other static hosts. */
  base: '/',
  /** Always resolve from repo root even when `npm run dev` is started from a subfolder. */
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: 'node_modules/.vite',
  /** Applies to dev transforms and optimizeDeps (build.target alone is production-only). */
  esbuild: {
    target: 'es2022',
  },
  optimizeDeps: {
    include: [
      'recharts',
      'react',
      'react-dom',
      'react-router',
      /** Pre-bundle subscription gating — avoids flaky lazy-route fetch of raw .ts in dev. */
      'src/app/lib/subscriptionCapabilities.ts',
      'src/app/lib/subscriptionFeatureCatalog.ts',
      /** Single React context instance for business guidelines (lazy dashboard chunks). */
      'src/app/contexts/businessGuidelinesContextRef.ts',
    ],
    esbuildOptions: {
      target: 'es2022',
    },
  },
  /** Expose VITE_* and NEXT_PUBLIC_* from .env to import.meta.env (QR / app URL). */
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  define: {
    /** Baked at build/dev start from BASE_URL (preferred) or other public URL envs — see appPublicUrl.ts */
    'import.meta.env.VITE_CARETIP_APP_ORIGIN': JSON.stringify(injectedOrigin),
  },
  build: {
    /** esbuild 0.28+ no longer downlevels destructuring for legacy targets (see GHSA-gv7w-rqvm-qjhr override). */
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
    /**
     * Preload declared chunks in parallel. Without this each dependency was found only after its
     * parent downloaded. No polyfill: it would land in the landing route.
     */
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Keep Vite's dynamic-import helper in its own file. Otherwise Rollup
          // parks it inside a heavy manual chunk and every route downloads that chunk.
          if (id.includes('preload-helper')) return 'vendor-preload';
          if (!id.includes('node_modules')) return;
          const normalized = id.replaceAll('\\', '/');
          const inPackage = (name: string) => normalized.includes(`/node_modules/${name}/`);
          if (id.includes('clsx') || id.includes('tailwind-merge') || id.includes('class-variance-authority')) {
            return 'vendor-utils';
          }
          if (inPackage('recharts') || /\/node_modules\/d3-[^/]+\//.test(normalized)) return 'vendor-recharts';
          if (id.includes('/qrcode/') || id.includes('node_modules/qrcode')) return 'vendor-qrcode';
          // Leave three, @react-three, and troika in the lazy 3D route graph.
          // A vendor-three chunk also captured shared helpers and made the shader
          // download Recharts.
          if (id.includes('jspdf')) return 'vendor-jspdf';
          if (id.includes('i18next') || id.includes('react-i18next')) return 'vendor-i18n';
          if (id.includes('socket.io-client') || id.includes('engine.io-client')) return 'vendor-socket';
          if (id.includes('firebase')) return 'vendor-firebase';
          // Named packages only: a substring match also caught remotion, which pulled the video
          // player into a chunk that every page loads.
          if (inPackage('motion') || inPackage('framer-motion') || inPackage('motion-dom') || inPackage('motion-utils')) {
            return 'vendor-motion';
          }
          if (id.includes('html2canvas')) return 'vendor-html2canvas';
          if (id.includes('@radix-ui')) return 'vendor-radix';
          if (id.includes('react-router') || id.includes('@remix-run/router')) return 'vendor-router';
          if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react';
        },
      },
    },
  },
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    bootAssetsMetaPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'apple-touch-icon.png',
        'icon-192.png',
        'icon-512.png',
        'favicon-32.png',
        'caretip-font-faces.css',
        'fonts/**/*.woff2',
      ],
      manifest: {
        /** Stable id helps Chromium replace the installed app manifest on updates (splash colors). */
        id: '/',
        name: 'CareTip',
        short_name: 'CareTip',
        description:
          'Digital tipping for hospitality: scan, tip, and support your team.',
        /** Off-white launch screen — matches first paint + branded loading overlay (no orange flash). */
        theme_color: '#FAF9F6',
        background_color: '#FAF9F6',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        lang: 'en',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          /** Intentionally no maskable entry: Chromium/Android may composite maskable icons as monochrome silhouettes. */
        ],
      },
      workbox: {
        /** Bump when PWA shell/manifest semantics change so old precaches are abandoned. */
        cacheId: 'caretip-pwa-v13',
        /** Ensure old precaches are removed when SW updates. */
        cleanupOutdatedCaches: true,
        /**
         * Keep precache small so refreshes don't "re-download the world".
         * Large marketing/dashboard images live in `dist/assets/*` and should be runtime-cached instead.
         */
        globPatterns: [
          'index.html',
          '*.{ico,svg,webmanifest}',
          'assets/index-*.{js,css}',
          'assets/vendor-react-*.js',
        ],
        globIgnores: ['**/assets/*.{png,jpg,jpeg,webp,gif}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [
          /^\/api(\/|$)/,
          /^\/uploads(\/|$)/,
          /^\/socket\.io/,
        ],
        /**
         * Allow the main JS bundle in the precache (app shell),
         * but keep large images out via `globIgnores` above.
         */
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        importScripts: [
          'https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js',
          'https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js',
          '/fcm-sw-handler.js',
        ],
        runtimeCaching: [
          {
            // Hashed filenames never change, so a stored copy is always correct.
            urlPattern: ({ url }) => url.pathname.startsWith('/assets/') && /\.(js|css|woff2)$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'caretip-route-chunks-v1',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Hashed Vite assets: prefer network so deploys are not stuck on stale SWR entries.
            // Short timeout keeps offline/repeat visits fast via cache fallback.
            urlPattern: ({ url }) => url.pathname.startsWith('/assets/') && /\.(png|jpe?g|webp|gif)$/i.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'caretip-static-images-v13',
              networkTimeoutSeconds: 4,
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 60 * 60 * 24 * 14,
              },
              // Never cache opaque (status 0) responses — they can paint as blank.
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'caretip-google-fonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory (ESM-safe; no __dirname)
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  server: {
    host: true,
    /** Optional: `npm run dev:https` for Facebook Login without HTTP-page warnings (self-signed cert). */
    https: loaded.CARETIP_DEV_HTTPS === 'true' ? {} : undefined,
    watch: {
      ignored: ['**/_reference/**', '**/TrickyFreshString.zip'],
    },
    proxy: {
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        /** Keep refresh cookie on the Vite dev origin (localhost:5173). */
        cookieDomainRewrite: '',
        configure: apiProxyUnreachableAs503,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },

  // Same proxy for `vite preview` so /api works without VITE_API_URL in the built app.
  preview: {
    proxy: {
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        /** Keep refresh cookie on the Vite dev origin (localhost:5173). */
        cookieDomainRewrite: '',
        configure: apiProxyUnreachableAs503,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  }
})
