import { Component, Inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { RouterOutlet } from '@angular/router'
import { Electric } from '../generated/client'
import { ELECTRIC_CLIENT, injectElectric } from './electric'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'wa-sqlite-example-angular'

  // public client2 = injectElectric()

  constructor(@Inject(ELECTRIC_CLIENT) public client: Electric) {}
}
