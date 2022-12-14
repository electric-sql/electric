import Database from 'better-sqlite3'

import { electrify, ElectrifiedDatabase} from 'electric-sql/node'
import * as fs from 'fs';
import {v4 as uuidv4} from 'uuid';

export const read_migrations = (migration_file: string) => {
  const data = fs.readFileSync(migration_file)
  const json_data = JSON.parse(data);
  return json_data.migrations
}

export const open_db = (name: string,
                        host: string,
                        port: number,
                        migrations: any
                       ) => {
  //= () => Promise<ElectrifiedDatabase> {
  const original = new Database(name)
  const config = {
    app: 'satellite_client',
    migrations: migrations,
    replication: {
      host: host,
      port: port,
      insecure: true,
    },
    token: "token"
  }
  return electrify(original, config)
}

export const set_subscribers = (db: ElectrifiedDatabase) => {
  db.electric.notifier.subscribeToAuthStateChanges((x) => {
    console.log("auth state changes: ")
    console.log(x)
  })
  db.electric.notifier.subscribeToPotentialDataChanges((x) => {
    console.log("potential data change: ")
    console.log(x)
  })
  db.electric.notifier.subscribeToDataChanges((x) => {
    console.log("data changes: ")
    console.log(JSON.stringify(x))
  })
}

export const get_items = (db: ElectrifiedDatabase) => {
  const stmt = db.prepare('SELECT * FROM main.items;')
  return stmt.all([])
}

export const insert_item = (db: ElectrifiedDatabase, keys: [ string ] ) => {
  const st = db.prepare('INSERT INTO main.items (id, content) VALUES ( @uuid, @key )');
  for ( var key of keys ) {
    let myuuid = uuidv4();
    st.run({key: key, uuid: myuuid});
  }
}

export const delete_item = (db: ElectrifiedDatabase, keys: [ string ]) => {
  const st = db.prepare("DELETE FROM main.items WHERE content = ?")
  for ( var key of keys ) {
    st.run(key);
  }
}

export const run = (db: ElectrifiedDatabase) => {
  const stmt = db.prepare('select 1')
  return db.transaction((bind) => {
    stmt.run(bind);
  });
}
