import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { Electric } from '../generated/client';
import { SecondaryComponent } from './secondary/secondary.component';
import { injectElectric } from './electric';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SecondaryComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'document-editor';


  public client2 = injectElectric()

  // constructor(@Inject(ELECTRIC_CLIENT) public client: Electric) {
  }
