import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { Electric } from '../generated/client';
import { SecondaryComponent } from './secondary/secondary.component';
import { ELECTRIC_CLIENT, injectElectric } from './electric';
import { ElectricProviderComponent } from './electric-provider.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SecondaryComponent, ElectricProviderComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'wa-sqlite-example-angular';


  // public client2 = injectElectric()

  constructor(@Inject(ELECTRIC_CLIENT) public client: Electric) {
  }
}
