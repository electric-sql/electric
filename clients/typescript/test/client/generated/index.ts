import { DbSchema, Relation, ElectricClient, TableSchema } from '../../../src/client/model';
import migrations from './migrations';
import pgMigrations from './pg-migrations';

export const tableSchemas = {
  Items: {
    fields: {
      value: "TEXT",
      nbr: "INT4"
    },
    relations: [
    ],
  } as TableSchema,
  User: {
    fields: {
      id: "INT4",
      name: "TEXT",
      meta: "TEXT"
    },
    relations: [
      new Relation("posts", "", "", "Post", "PostToUser"),
      new Relation("profile", "", "", "Profile", "ProfileToUser"),
    ],
  } as TableSchema,
  Post: {
    fields: {
      "id": "INT4",
      "title": "TEXT",
      "contents": "TEXT",
      "nbr": "INT4",
      "authorId": "INT4"
    },
    relations: [
      new Relation("author", "authorId", "id", "User", "PostToUser"),
    ],
  } as TableSchema,
  Profile: {
    fields: {
      "id": "INT4",
      "bio": "TEXT",
      "meta": "JSONB",
      "userId": "INT4",
      "imageId": "TEXT"
    },
    relations: [
      new Relation("user", "userId", "id", "User", "ProfileToUser"),
      new Relation("image", "imageId", "id", "ProfileImage", "ProfileToProfileImage"),
    ],
  } as TableSchema,
  ProfileImage: {
    fields: {
      "id": "TEXT",
      "image": "BYTEA"
    },
    relations: [
      new Relation("profile", "", "", "Profile", "ProfileToProfileImage"),
    ],
  } as TableSchema,
  DataTypes: {
    fields: {
      "id": "INT4",
      "date": "DATE",
      "time": "TIME",
      "timetz": "TIMETZ",
      "timestamp": "TIMESTAMP",
      "timestamptz": "TIMESTAMPTZ",
      "bool": "BOOL",
      "uuid": "UUID",
      "int2": "INT2",
      "int4": "INT4",
      "int8": "INT8",
      "float4": "FLOAT4",
      "float8": "FLOAT8",
      "json": "JSONB",
      "bytea": "BYTEA",
      "relatedId": "INT4"
    },
    relations: [
      new Relation("related", "relatedId", "id", "Dummy", "DataTypesToDummy"),
    ],
  } as TableSchema,
  Dummy: {
    fields: {
      "id": "INT4",
      "timestamp": "TIMESTAMP"
    },
    relations: [
      new Relation("datatype", "", "", "DataTypes", "DataTypesToDummy"),
    ],
  } as TableSchema
}

export const schema = new DbSchema(tableSchemas, migrations, pgMigrations)
export type Electric = ElectricClient<typeof schema>
export const JsonNull = { __is_electric_json_null__: true }
