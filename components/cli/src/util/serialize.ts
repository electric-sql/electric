import { dedent } from 'ts-dedent'
import { DbSchema } from 'electric-sql/client'

/**
 * Custom serialization function that serializes the DB description
 * into source code that is meant to be bundled in Electric applications.
 * The generated string is NOT in JSON format but is actual JS source code
 * (as it instantiates `Relation` objects)
 * that is meant to be imported by the Electric application.
 */
export function serializeDbDescription(dbDescription: DbSchema) {
  const tables = Object.entries(dbDescription)
    .map(([table, schema]) => {
      return dedent`
      ${table}: {
        "fields": {
          ${Object.entries(schema.fields)
            .map(([field, type]) => {
              return `"${field}": "${type}"`
            })
            .join(',\n')}
        },
        "relations": [
          ${schema.relations
            .map((r) => {
              return dedent`
              new Relation(
                "${r.relationField}",
                "${r.fromField}",
                "${r.toField}",
                "${r.relatedTable}",
                "${r.relationName}",
                "${r.relatedObjects}"
              )
            `
            })
            .join(',\n')}
        ]
      }
    `
    })
    .join(',\n')

  return dedent`
    {
      ${tables}
    }
  `
}
