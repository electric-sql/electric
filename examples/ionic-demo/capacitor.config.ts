import { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.ionic.starter',
  appName: 'Electric Appointments',
  webDir: 'dist',
  android: {
    // enable if using Electric without SSL
    // allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    // enable if using Electric without SSL
    // cleartext: true,
  },
}

export default config
