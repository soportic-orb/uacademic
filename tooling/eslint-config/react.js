import i18next from 'eslint-plugin-i18next'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

import { baseConfig } from './base.js'

/**
 * R1: `i18next/no-literal-string` is what makes "zero literal strings in
 * components" mechanical instead of aspirational.
 * R8: jsx-a11y runs on every component.
 */
export const reactConfig = tseslint.config(...baseConfig, {
  languageOptions: {
    globals: { ...globals.browser },
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
  plugins: {
    'react-hooks': reactHooks,
    'react-refresh': reactRefresh,
    'jsx-a11y': jsxA11y,
    i18next,
  },
  rules: {
    ...jsxA11y.flatConfigs.recommended.rules,
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    'i18next/no-literal-string': [
      'error',
      {
        mode: 'jsx-text-only',
        'should-validate-template': true,
        message: 'User-facing text must go through i18next (R1: trilingual, always).',
      },
    ],
  },
})

export default reactConfig
