import { dedent } from 'ts-dedent'
import { DbSchema } from 'electric-sql/client'

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
