import { Component, OnInit, signal } from "@angular/core";
import { Electric, schema } from "../generated/client";
import { uniqueTabId } from "electric-sql/util";
import { environment } from "../environments/environment";
import { LIB_VERSION } from "electric-sql/version";
import { authToken } from "./auth";
import { electrify, ElectricDatabase } from 'electric-sql/wa-sqlite'
import { ElectricConfig } from "electric-sql";

@Component({
    selector: 'electric-provider',
    template: `
    @if (electric()) {
        <ng-content />
    }
    `,
    standalone: true
})
export class ElectricProviderComponent implements OnInit {

    electric = signal<Electric | null>(null);
    
    async ngOnInit(): Promise<void> {
        const { tabId } = uniqueTabId()
        const scopedDbName = `basic-${LIB_VERSION}-${tabId}.db`
      
        const config: ElectricConfig = {
          url: environment.ELECTRIC_URL,
          debug: environment.DEV,
        }
      
        const conn = await ElectricDatabase.init(scopedDbName)
      
        const electricClient = await electrify(conn, schema, config)
      
        await electricClient.connect(authToken())
      
        // Resolves when the shape subscription has been established.
        const shape = await electricClient.db.items.sync()
      
        await shape.synced
    }
}