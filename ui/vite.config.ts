import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Everything is bundled locally: no CDN fonts, scripts or images (works offline on the GB10).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GB10 / any static server: relative asset paths. Hosted preview (Vercel serves from the domain root): absolute, so a
  // deep path such as /console/skills still finds /assets/* instead of /console/assets/*.
  base: process.env.VITE_PREVIEW === "1" ? "/" : "./",
  build: { target: "es2022", sourcemap: false }, // no source maps shipped in the demo build
});
