/* tslint:disable */
/* eslint-disable */
import "sst"
declare module "sst" {
  export interface Resource {
    "write-patterns-production-vpc": {
      "type": "sst.aws.Vpc"
    }
    "write-patterns-service-production": {
      "service": string
      "type": "sst.aws.Service"
      "url": string
    }
    "write-patterns-website": {
      "type": "sst.aws.StaticSite"
      "url": string
    }
  }
}
export {}
