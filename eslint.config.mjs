import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";
import tseslint from "@typescript-eslint/eslint-plugin";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: {
      "react-hooks": reactHooks,
      react,
      "@typescript-eslint": tseslint,
    },
    rules: {
      // Existing demo pages call data-loading functions from effects and use
      // render-time date defaults. Keep these visible without blocking CI.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Python venv under monorepo (vendor bundles get picked up as JS)
    "agent-service/.venv/**",
    "**/.venv/**",
    // Node CJS scripts use require(); not part of the Next/TS app bundle
    "scripts/**/*.cjs",
    "scratch-test.cjs",
    "search-password.js",
  ]),
]);

export default eslintConfig;
