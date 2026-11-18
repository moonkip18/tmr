// electron/build.config.js
// Produces a portable Windows .exe (no installer).
// Build: npx electron-builder --config electron/build.config.js
module.exports = {
  appId: 'com.synapsis.tmr',
  productName: 'synapsis',
  directories: {
    output: 'release',
    buildResources: 'electron',
  },
  files: [
    'electron/main.js',
    'electron/preload.js',
    'package.json',
    'www/**/*',
    'node_modules/electron/**/*',
  ],
  win: {
    target: [{ target: 'portable', arch: 'x64' }],
    publisherName: 'synapsis',
  },
  portable: {
    oneFile: true,
    allowToChangeWSL: false,
  },
  npmRebuild: false,
  verifyCodeSignatures: false,
};
