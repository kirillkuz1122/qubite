// Правила проверки JS/TS-кода Qubite.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'legacy/**',
      // рабочие копии и настройки агентов
      '.claude/**',
      'assets/**',
      'target/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/test-results/**',
      '**/playwright-report/**',
      'packages/api-client/src/schema.ts',
      // живые прототипы дизайна (обычный JS в браузере, не код продукта)
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // service worker push-напоминаний (PLAN-004): обычный JS в контексте worker
    files: ['apps/web/public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['packages/ui/**/*.{ts,tsx}', 'packages/motion/**/*.ts'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Анимация идёт мимо React: пружины — изменяемые объекты, их кадры пишут стили прямо из общего цикла.
      // Поэтому пружины создаются один раз и меняются в обработчиках и эффектах — это намеренно.
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
    },
  },
  {
    files: ['**/*.config.{js,ts}', 'apps/web/e2e/**'],
    languageOptions: { globals: globals.node },
  },
);
