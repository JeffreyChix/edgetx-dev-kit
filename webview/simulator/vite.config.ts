import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const PORT = 5174;

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server:
    command === "serve"
      ? {
          port: PORT,
          strictPort: true,
          cors: { origin: "*" },
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "credentialless",
          },
        }
      : undefined,
  build: {
    outDir: "dist",
    assetsInlineLimit: 10000,
  },
}));
