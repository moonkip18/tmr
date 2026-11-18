// capacitor.config.ts
import type { Config } from '@capacitor/cli';

const config: Config = {
  appId: 'com.synapsis.tmr',
  appName: 'synapsis',
  webDir: 'www',
  // the phone build owns the overnight TMR foreground service.
  server: {
    url: 'http://10.0.2.2:5173',
    cleartext: true,
  },
};
export default config;
