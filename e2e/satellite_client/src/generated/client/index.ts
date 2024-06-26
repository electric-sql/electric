import { type TableSchemas, DbSchema, Relation, ElectricClient } from 'electric-sql/client/model'
import migrations from './migrations'
import pgMigrations from './pg-migrations'

export const tableSchemas = {
  blobs: {
    fields: {
      "id": "TEXT",
      "blob": "BYTEA"
    },
    relations: []
  },
  bools: {
    fields: {
      "id": "TEXT",
      "b": "BOOL"
    },
    relations: []
  },
  datetimes: {
    fields: {
      "id": "TEXT",
      "d": "DATE",
      "t": "TIME"
    },
    relations: []
  },
  enums: {
    fields: {
      "id": "TEXT",
      "c": "TEXT"
    },
    relations: []
  },
  floats: {
    fields: {
      "id": "TEXT",
      "f4": "FLOAT4",
      "f8": "FLOAT8"
    },
    relations: []
  },
  ints: {
    fields: {
      "id": "TEXT",
      "i2": "INT2",
      "i4": "INT4",
      "i8": "INT8"
    },
    relations: []
  },
  items: {
    fields: {
      "id": "TEXT",
      "content": "TEXT",
      "content_text_null": "TEXT",
      "content_text_null_default": "TEXT",
      "intvalue_null": "INT4",
      "intvalue_null_default": "INT4"
    },
    relations: [
      new Relation("other_items", "", "", "other_items", "ItemsToOther_items"),
    ]
  },
  jsons: {
    fields: {
      "id": "TEXT",
      "jsb": "JSONB"
    },
    relations: []
  },
  other_items: {
    fields: {
      "id": "TEXT",
      "content": "TEXT",
      "item_id": "TEXT"
    },
    relations: [
      new Relation("items", "item_id", "id", "items", "ItemsToOther_items"),
    ]
  },
  timestamps: {
    fields: {
      "id": "TEXT",
      "created_at": "TIMESTAMP",
      "updated_at": "TIMESTAMPTZ"
    },
    relations: []
  },
  uuids: {
    fields: {
      "id": "UUID"
    },
    relations: []
  },
} as TableSchemas

export const schema = new DbSchema(tableSchemas, migrations, pgMigrations)
export type Electric = ElectricClient<typeof schema>
export const JsonNull = { __is_electric_json_null__: true }