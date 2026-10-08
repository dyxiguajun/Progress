import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createPairingMiddleware } from './scripts/pairing-agent.mjs';
import { createCodexMiddleware } from './scripts/codex-agent.mjs';

export default defineConfig({ plugins: [react(), { name: 'progress-codex-local', configureServer(server) {
  const bridge = createCodexMiddleware();
  const pairing = createPairingMiddleware(bridge.agent);
  server.middlewares.use((req,res,next) => { void pairing.handler(req,res,next); });
  server.httpServer?.on('close', pairing.close);
  server.middlewares.use((req, res, next) => { void bridge.handler(req, res, next); });
  server.httpServer?.on('close', bridge.close);
} }], server: { port: 5173, strictPort: true },
  build: { rollupOptions: { output: { manualChunks: { 'data-tools': ['jszip', 'ajv'] } } } } });
