import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import vue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["**/dist/", "**/dev-dist/", "**/.output/", "**/.nuxt/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  vue.configs["flat/recommended"],
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ["**/*.vue"],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
    rules: {
      // TypeScript already checks for undefined names, including Vue's compiler macros.
      "no-undef": "off",
      // Page and component names like App.vue or LabKbd.vue are fine as they are.
      "vue/multi-word-component-names": "off",
    },
  },
  // Turns off formatting rules; Prettier handles formatting.
  prettier,
);
