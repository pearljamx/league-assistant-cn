import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  root: "src/renderer",
  plugins: [vue()],
  server: { port: 5173, strictPort: true },
  build: { outDir: "../../artifacts/web", emptyOutDir: true },
});
