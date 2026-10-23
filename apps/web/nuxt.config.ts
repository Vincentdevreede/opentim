import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2026-10-01",
  devtools: { enabled: true },
  css: ["~/assets/css/main.css"],
  vite: {
    plugins: [tailwindcss()],
  },
  app: {
    head: {
      title: "OpenTIM",
      meta: [{ name: "description", content: "An open-source reimplementation of The Incredible Machine." }],
    },
  },
});
