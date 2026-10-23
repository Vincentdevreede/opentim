import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5175, strictPort: true },
  plugins: [vue(), tailwindcss()],
});
