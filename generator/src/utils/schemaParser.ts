export type Attribute = {
  type: `@${string}`
  args: Array<string>
}
export type Field = {
  field: string
  type: string
  attributes: Array<Attribute>
}
export type Model = {
  name: string
  fields: Array<Field>
}

/**
 * Parses the Prisma schema and returns all models.
 * @param prismaSchema The Prisma schema to parse
 * @returns Array of models.
 */
export function parseModels(prismaSchema: string): Array<Model> {
  // Remove comments
  const commentRegex = /\/\/.*$/gm // matches // until end of the line
  const schema = prismaSchema.replaceAll(commentRegex, '')

  // Match models defined in the schema
  const modelRegex = /^\s*model\s+(?<name>\w+)\s*{(?<body>[^}]*)}/gm
  const matches = [...schema.matchAll(modelRegex)]
  const modelBodies = matches.map(
    (match) => match.groups! as { name: string; body: string }
  )

  // Match fields in the body of the models
  return modelBodies.map(({ name, body }) => {
    return {
      name,
      fields: parseFields(body),
    }
  })
}

/**
 * Takes the body of a model and returns
 * an array of fields defined by the model.
 * @param body Body of a model
 * @returns Fields defined by the model
 */
function parseFields(body: string): Array<Field> {
  // The regex below matches the fields of a model (it assumes there are no comments at the end of the line)
  // It uses named captured groups to capture the field name, its type, and optional attributes
  // the type can be `type` or `type?` or `type[]`
  const fieldRegex =
    /^\s*(?<field>\w+)\s+(?<type>[\w]+(\?|(\[]))?)\s*(?<attributes>((@[\w.]+\s*)|(@[\w.]+\(.*\)+\s*))+)?\s*$/gm
  const fieldMatches = [...body.matchAll(fieldRegex)]
  const fs = fieldMatches.map(
    (match) =>
      match.groups as { field: string; type: string; attributes?: string }
  )
  return fs.map((f) => ({
    ...f,
    attributes: parseAttributes(f.attributes ?? ''),
  }))
}

/**
 * Takes a string of attributes, e.g. `@id @db.Timestamp(2)`,
 * and returns an array of attributes, e.g. `['@id', '@db.Timestamp(2)]`.
 * @param attributes String of attributes
 * @returns Array of attributes.
 */
function parseAttributes(attributes: string): Array<Attribute> {
  // Matches each attribute in a string of attributes
  // e.g. @id @db.Timestamp(2)
  // The optional args capture group matches anything
  // but not @or newline because that would be the start of a new attribute
  const attributeRegex = /(?<type>@[\w\.]+)(?<args>\([^@\n\r]+\))?/g
  const matches = [...attributes.matchAll(attributeRegex)]
  return matches.map((m) => {
    const { type, args } = m.groups! as { type: string; args?: string }
    const noParens = args?.substring(1, args.length - 1) // arguments without starting '(' and closing ')'
    const parsedArgs = noParens?.split(',')?.map((arg) => arg.trim()) ?? []
    return {
      type: type as `@${string}`,
      args: parsedArgs,
    }
  })
}
