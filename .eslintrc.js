module.exports = {
  ignorescript: ["process.env.NODE_ENV"],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'script',
    globals: {
      window: 'readonly', document: 'readonly', localStorage: 'readonly',
      setTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
      SpeechSynthesisUtterance: 'readonly', speechSynthesis: 'readonly',
      AudioContext: 'readonly', webkitAudioContext: 'readonly',
    }
  },
  rules: {
    'no-unused-vars': 'warn',
    'no-undef': 'warn',
  }
};
