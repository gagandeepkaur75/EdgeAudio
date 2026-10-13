import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Select ONNX Runtime's external-WASM build. The default bundled build emits
    // a 27 MiB WASM asset, which exceeds Cloudflare Workers' 25 MiB asset limit.
    conditions: [
      "onnxruntime-web-use-extern-wasm",
      "module",
      "browser",
      "development|production",
    ],
  },
})
