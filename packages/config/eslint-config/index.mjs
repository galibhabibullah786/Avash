// Shared flat ESLint config (ESLint 9+).
// Enforces R2 (secrets never reach the client) and R9-adjacent hygiene rules.
import tseslint from 'typescript-eslint';

/**
 * Selectors that catch `import.meta.env.X` and `process.env.X` accesses
 * under apps/web/src where X does not start with VITE_PUBLIC_ (R2, §7.1).
 */
const noNonPublicEnvUnderWeb = {
  files: ['src/**/*.{ts,tsx}', 'apps/web/src/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector:
          'MemberExpression[object.type="MemberExpression"][object.property.name="env"][object.object.type="MetaProperty"][property.name!=/^VITE_PUBLIC_/]',
        message:
          'apps/web must never read a non-VITE_PUBLIC_ env var (R2). Secrets live in apps/api or GitHub Actions.',
      },
      {
        selector:
          'MemberExpression[object.type="MemberExpression"][object.property.name="env"][object.object.name="process"][property.name!=/^VITE_PUBLIC_/]',
        message:
          'apps/web must never read a non-VITE_PUBLIC_ env var (R2). Secrets live in apps/api or GitHub Actions.',
      },
    ],
  },
};

export default [
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-unused-vars': 'off',
      // argsIgnorePattern: an unimplemented stub's parameters are unused by
      // definition (e.g. `throw new Error('not implemented')`) but still
      // need to be named to declare the eventual contract shape.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  noNonPublicEnvUnderWeb,
  {
    ignores: [
      '**/dist/**',
      '**/dist-node/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/.wrangler/**',
    ],
  },
];
