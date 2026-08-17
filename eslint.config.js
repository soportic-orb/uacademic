import nodeConfig from '@uacademic/eslint-config/node'
import reactConfig from '@uacademic/eslint-config/react'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/generated/**',
      '**/node_modules/**',
      '**/.vite/**',
      '**/dev-dist/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', 'tooling/**/*.js', '*.js'],
    extends: nodeConfig,
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: reactConfig,
  },
  {
    // Seeds and scripts legitimately write to stdout.
    files: ['packages/db/seed/**/*.ts', 'packages/db/scripts/**/*.ts', '**/scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
)
