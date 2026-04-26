import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src/routeTree.gen.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // shadcn: CVA variants are re-exported alongside the component
    files: ['src/components/ui/button.tsx', 'src/components/ui/badge.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // TanStack Router: route modules export a `Route` object, not only React components
    files: ['src/routes/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
