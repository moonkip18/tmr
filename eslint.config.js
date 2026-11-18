export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', localStorage: 'readonly',
        setTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        clearTimeout: 'readonly', confirm: 'readonly',
        SpeechSynthesisUtterance: 'readonly', speechSynthesis: 'readonly',
        AudioContext: 'readonly', webkitAudioContext: 'readonly',
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'warn',
    }
  },
  {
    ignores: ['node_modules/**', 'release/**', 'android/**']
  }
];
