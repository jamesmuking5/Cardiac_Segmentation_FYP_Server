// eslint.config.js
// Generated with Gemini Advanced 2.5 Pro
import { defineConfig } from "eslint/config";
import globals from "globals";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier"; // Import Prettier config

export default defineConfig([
  // Base configurations for JS and TS
  js.configs.recommended,
  ...tseslint.configs.recommended, // Spread recommended TS configs (assuming it's an array)

  // Configuration applying to your specific files
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      ecmaVersion: "latest", // Good practice to specify
      sourceType: "module",  // Assuming ESM
      globals: {
        ...globals.browser, // Keep browser globals if needed
        // ...globals.node // Add node globals if needed, perhaps in a separate config object targeting specific files
      }
    },
    // You can add specific rule overrides here if needed
    // rules: {
    //   "some-eslint-rule": "warn",
    // }
  },

  // Prettier config MUST BE LAST!
  // This turns off all ESLint rules that conflict with Prettier.
  eslintConfigPrettier,
]);