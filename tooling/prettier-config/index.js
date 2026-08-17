/** @type {import('prettier').Config} */
export default {
  semi: false,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  arrowParens: 'always',
  endOfLine: 'lf',
  overrides: [
    {
      files: ['*.json', '*.md', '*.yml', '*.yaml'],
      options: { singleQuote: false },
    },
  ],
}
