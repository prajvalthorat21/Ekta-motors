import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';

// Plugin to handle graceful WebSocket error suppression for cloud proxy environments
function aiStudioHmrProxyPlugin(): Plugin {
  return {
    name: 'ai-studio-hmr-proxy-resilience',
    enforce: 'post',
    transform(code, id) {
      if (id.includes('client.mjs') || id.includes('@vite/client')) {
        let transformed = code;
        // Gracefully catch and log debug rather than throwing unhandled rejection on proxy drop
        transformed = transformed.replace(
          'console.error(`[vite] failed to connect to websocket (${e}). `);\n          throw e;',
          'console.debug(`[vite] HMR websocket connection closed by proxy environment.`);'
        );
        transformed = transformed.replace(
          /console\.error\(\s*`\[vite\] failed to connect to websocket[\s\S]*?`\s*\);/g,
          'console.debug(`[vite] HMR websocket connection closed by proxy environment.`);'
        );
        return transformed;
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), aiStudioHmrProxyPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          adminLogin: path.resolve(__dirname, 'admin-login.html'),
          adminDashboard: path.resolve(__dirname, 'admin-dashboard.html'),
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
      cors: true,
      allowedHosts: true as const,
      hmr: {
        clientPort: 443,
      },
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
