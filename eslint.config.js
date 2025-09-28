import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-plugin-prettier'
import globals from 'globals'

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      prettier: prettier,
    },
    rules: {
      // Prettier integration
      'prettier/prettier': ['error', {}, { usePrettierrc: true }],

      // Disable conflicting base rules
      'no-unused-vars': 'off',
      'no-undef': 'off', // TypeScript handles this
      'no-redeclare': 'off', // TypeScript handles this

      // TypeScript-specific rules
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'warn',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/prefer-string-starts-ends-with': 'warn',
      '@typescript-eslint/prefer-includes': 'warn',
      '@typescript-eslint/prefer-readonly': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],

      // Code quality rules
      'prefer-const': 'warn',
      'no-var': 'error',
      'no-console': 'off',
      'no-debugger': 'warn',
      'no-alert': 'warn',
      'no-duplicate-imports': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'error',
      'no-empty': 'warn',
      'no-irregular-whitespace': 'error',
      'no-multiple-empty-lines': ['warn', { max: 2, maxEOF: 1 }],
      'no-trailing-spaces': 'warn',
      'no-unexpected-multiline': 'error',
      'no-unreachable-loop': 'warn',
      'no-useless-return': 'warn',
      'prefer-arrow-callback': 'warn',
      'prefer-template': 'warn',
      'quote-props': ['warn', 'as-needed'],
    },
  },
  // Type-aware rules configuration
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Type-aware rules (require type information)
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/await-thenable': 'warn',
      '@typescript-eslint/no-for-in-array': 'warn',
      '@typescript-eslint/no-implied-eval': 'warn',
      '@typescript-eslint/no-misused-new': 'warn',
      '@typescript-eslint/prefer-promise-reject-errors': 'warn',
      '@typescript-eslint/return-await': 'warn',
      '@typescript-eslint/restrict-plus-operands': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/unbound-method': 'warn',

      // Override some strict rules to be warnings
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
    },
  },
  // Test files configuration
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
    env: { 'vitest/globals': true },
  },
]
