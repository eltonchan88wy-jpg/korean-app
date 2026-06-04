import { defineConfig } from 'vite'

export default defineConfig({
  // 开发服务器：代理 KRDict 请求，解决 CORS 问题
  server: {
    port: 5173,
    proxy: {
      '/krdict-proxy': {
        target: 'https://krdict.korean.go.kr',
        changeOrigin: true,
        secure: false,
        rewrite: path => path.replace('/krdict-proxy', '/api'),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; KoreanLearningApp/1.0)',
          'Referer': 'https://krdict.korean.go.kr',
        },
      },
    },
  },

  build: {
    outDir: 'dist',
    // 分包：把词库单独拆出来，加快首屏加载
    rollupOptions: {
      output: {
        manualChunks: {
          vocabulary: ['./src/vocabulary.js'],
          firebase:   ['./src/firebase-config.js'],
        },
      },
    },
  },
})
