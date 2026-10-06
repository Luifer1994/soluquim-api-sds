// @ts-check
import eslint from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'eslint.config.mjs', 'jest.config.js'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.json' } },
      // Capas del servicio — ver PLAN-FDS-MICROSERVICIO.md §7.2
      'boundaries/elements': [
        { type: 'shared', pattern: 'src/shared/**' },
        { type: 'source', pattern: 'src/modules/source/**' },
        { type: 'substance', pattern: 'src/modules/substance/**' },
        { type: 'classification', pattern: 'src/modules/classification/**' },
        { type: 'regulation', pattern: 'src/modules/regulation/**' },
        { type: 'knowledge', pattern: 'src/modules/knowledge/**' },
        { type: 'sds', pattern: 'src/modules/sds/**' },
      ],
    },
    rules: {
      // Siempre alias @/ — nunca rutas relativas (convención del equipo, igual que soluquim-web-app).
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['./*', '../*'], message: 'Usa el alias @/ (y el index.ts de la carpeta), no rutas relativas.' }] },
      ],
      // Dependencias en un solo sentido, sin ciclos entre módulos.
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            { from: { element: { type: 'shared' } }, allow: [{ to: { element: { type: 'shared' } } }] },
            { from: { element: { type: 'source' } }, allow: [{ to: { element: { type: 'shared' } } }, { to: { element: { type: 'source' } } }] },
            { from: { element: { type: 'substance' } }, allow: [{ to: { element: { type: 'shared' } } }, { to: { element: { type: 'source' } } }, { to: { element: { type: 'substance' } } }] },
            { from: { element: { type: 'classification' } }, allow: [{ to: { element: { type: 'shared' } } }, { to: { element: { type: 'classification' } } }] },
            { from: { element: { type: 'regulation' } }, allow: [{ to: { element: { type: 'shared' } } }, { to: { element: { type: 'regulation' } } }] },
            { from: { element: { type: 'knowledge' } }, allow: [{ to: { element: { type: 'shared' } } }, { to: { element: { type: 'source' } } }, { to: { element: { type: 'substance' } } }, { to: { element: { type: 'knowledge' } } }] },
            { from: { element: { type: 'sds' } }, allow: [{ to: { element: { type: 'shared' } } }, { to: { element: { type: 'source' } } }, { to: { element: { type: 'substance' } } }, { to: { element: { type: 'knowledge' } } }, { to: { element: { type: 'classification' } } }, { to: { element: { type: 'regulation' } } }, { to: { element: { type: 'sds' } } }] },
          ],
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
