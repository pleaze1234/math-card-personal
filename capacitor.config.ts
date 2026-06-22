import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.personal.mathcard',
  appName: 'Math Cycle',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
