import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Isolated spike: reads the shared event adapter and sprites from ../../ui/src/world (read-only import).
export default defineConfig({ plugins: [react()], base: "./", server: { fs: { allow: ["../.."] } }, build: { target: "es2022" } });
