import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tseslintParser from "@typescript-eslint/parser";

import pluginReactRefresh from "eslint-plugin-react-refresh";
import hooksPlugin from 'eslint-plugin-react-hooks';

export default [
  pluginJs.configs.recommended,
  {
    ignores: [
      'dist/**',
      'app_dist/**',
      'dev-dist/**',
      'public/**',
      'service-worker.js',
      'launcher.cjs',
      'utils/vite.config.ts',
      '*.config.js',
      '*.config.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parser: tseslintParser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-refresh': pluginReactRefresh,
      'react-hooks': hooksPlugin,
    },
    rules: {
      'no-unused-vars': 'off',
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
];
