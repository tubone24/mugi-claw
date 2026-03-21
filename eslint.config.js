// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginSecurity from 'eslint-plugin-security';

export default tseslint.config(
  // Global ignores
  {
    ignores: ['dist/', 'node_modules/'],
  },

  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript recommended rules with type checking
  ...tseslint.configs.recommendedTypeChecked,

  // TypeScript language options
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Security plugin recommended rules
  pluginSecurity.configs.recommended,

  // Custom rules
  {
    rules: {
      // Security rules
      'no-eval': 'error',
      'no-implied-eval': 'error',

      // Quality rules
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': [
        'warn',
        {
          allow: ['warn', 'error'],
        },
      ],

      // Relax overly strict type-checked rules for existing codebase
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',

      // Allow control characters in regex (needed for sanitizer)
      'no-control-regex': 'off',
    },
  },

  // Test file overrides
  {
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
