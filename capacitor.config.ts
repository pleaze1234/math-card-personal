import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.personal.mathcard',
  appName: 'MathCard',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
