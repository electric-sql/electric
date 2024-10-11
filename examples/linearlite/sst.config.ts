/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: `linearlite`,
      removal: input?.stage === `production` ? `retain` : `remove`,
      home: `aws`,
    }
  },
  async run() {
    new sst.aws.StaticSite(`linearlite`, {
      environment: {
        VITE_ELECTRIC_URL: `https://api-dev-kylemathews-staging.electric-sql.com`,
      },
      build: {
        command: `npm run build`,
        output: `dist`,
      },
      domain: {
        name: `big-linearlite.electric-sql.com`,
        dns: sst.cloudflare.dns(),
      },
    })
  },
})
