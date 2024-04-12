import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { initElectric } from './app/electric';
import { initConfig } from './app/app.config';

initElectric().then((electricClient) => {
  return bootstrapApplication(AppComponent, initConfig(electricClient))
})
  .catch((err) => console.error(err));


