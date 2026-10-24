import { colors } from "@opentim/theme";
import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// Pad the maskable and Apple icons with the theme background instead of white.
const padded = { resizeOptions: { background: colors.surface } };

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, ...padded },
    apple: { ...minimal2023Preset.apple, ...padded },
  },
  images: ["public/icon.svg"],
});
