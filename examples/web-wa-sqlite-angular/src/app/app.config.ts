// import { ApplicationConfig } from "@angular/core";
// import { provideRouter } from "@angular/router";
// import { Electric } from "../generated/client";
// import { routes } from "./app.routes";
// import { provideElectric } from "./electric";


// export function initConfig(electricClient: Electric): ApplicationConfig {
//     const _ = provideElectric(electricClient);
//     debugger;
//     return {
//       providers: [
//         provideRouter(routes),
//         provideElectric(electricClient),
//       ]
//     };
//   }


import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
  ]
};
