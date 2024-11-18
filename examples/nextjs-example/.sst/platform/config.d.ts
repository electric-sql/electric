import "./src/global.d.ts"
import "../types.generated"
import { AppInput, App, Config } from "./src/config"
import * as _neon from "@sst-provider/neon";
import * as _aws from "@pulumi/aws";
import * as _cloudflare from "@pulumi/cloudflare";


declare global {
  // @ts-expect-error
  export import neon = _neon
  // @ts-expect-error
  export import aws = _aws
  // @ts-expect-error
  export import cloudflare = _cloudflare
  interface Providers {
    providers?: {
      "neon"?:  (_neon.ProviderArgs & { version?: string }) | boolean | string;
      "aws"?:  (_aws.ProviderArgs & { version?: string }) | boolean | string;
      "cloudflare"?:  (_cloudflare.ProviderArgs & { version?: string }) | boolean | string;
    }
  }
  export const $config: (
    input: Omit<Config, "app"> & {
      app(input: AppInput): Omit<App, "providers"> & Providers;
    },
  ) => Config;
}
