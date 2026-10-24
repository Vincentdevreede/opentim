import { colors } from "@opentim/theme";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// The game is deployed on its own subdomain, separate from the website.
export default defineConfig({
  server: { port: 5174 },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png", "icon.svg"],
      manifest: {
        name: "OpenTIM",
        short_name: "OpenTIM",
        description: "An open-source reimplementation of The Incredible Machine.",
        theme_color: colors.surface,
        background_color: colors.surface,
        display: "fullscreen",
        orientation: "landscape",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
      },
    }),
  ],
});
