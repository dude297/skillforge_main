import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Everything is bundled locally: no CDN fonts, scripts or images (works offline on the GB10).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  build: { target: "es2022", sourcemap: false }, // no source maps shipped in the demo build
});
