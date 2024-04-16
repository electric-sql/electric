import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
    selector: 'app-secondary',
    standalone: true,
    imports: [
        CommonModule,
    ],
    template: `<p>secondary works!</p><br>`,
    styleUrl: './secondary.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecondaryComponent {
//   public client2 = injectElectric()

}
