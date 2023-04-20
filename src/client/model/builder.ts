import { CreateInput, CreateManyInput } from '../input/createInput'
import squel, { PostgresSelect, QueryBuilder, WhereMixin } from 'squel'
import { FindInput, FindUniqueInput } from '../input/findInput'
import { UpdateInput, UpdateManyInput } from '../input/updateInput'
import { DeleteInput, DeleteManyInput } from '../input/deleteInput'
import flow from 'lodash.flow'
import { InvalidArgumentError } from '../validation/errors/invalidArgumentError'
import * as z from 'zod'

const squelPostgres = squel.useFlavour('postgres')

type AnyFindInput = FindInput<any, any, any, any, any>

export class Builder {
  constructor(private _tableName: string, private _fields: string[]) {}

  create(i: CreateInput<any, any, any>): QueryBuilder {
    // Make a SQL query out of the data
    return squelPostgres
      .insert()
      .into(this._tableName)
      .setFields(i.data)
      .returning('*')
  }

  createMany(i: CreateManyInput<any>): QueryBuilder {
    const insert = squelPostgres
      .insert()
      .into(this._tableName)
      .setFieldsRows(i.data)
    return i.skipDuplicates
      ? insert.onConflict() // adds "ON CONFLICT DO NOTHING" to the query
      : insert
  }

  findUnique(i: FindUniqueInput<any, any, any>): QueryBuilder {
    return this.findWhere({ ...i, take: 2 }, true) // take 2 such that we can throw an error if more than one record matches
  }

  findFirst(i: AnyFindInput): QueryBuilder {
    return this.findWhere({ ...i, take: 1 })
  }

  findMany(i: AnyFindInput): QueryBuilder {
    return this.findWhere(i)
  }

  // Finds a record but does not select the fields provided in the `where` argument
  // whereas `findUnique`, `findFirst`, and `findMany` also automatically select the fields in `where`
  findWithoutAutoSelect(i: AnyFindInput): QueryBuilder {
    return this.findWhere(i, false, false)
  }

  update(i: UpdateInput<any, any, any, any>): QueryBuilder {
    return this.updateInternal(i, true)
  }

  updateMany(i: UpdateManyInput<any, any>): QueryBuilder {
    return this.updateInternal(i)
  }

  delete(i: DeleteInput<any, any, any>): QueryBuilder {
    return this.deleteInternal(i, true)
  }

  deleteMany(i: DeleteManyInput<any>): QueryBuilder {
    return this.deleteInternal(i)
  }

  private deleteInternal(
    i: DeleteManyInput<any>,
    idRequired = false
  ): QueryBuilder {
    const deleteQuery = squel.delete().from(this._tableName)
    const whereObject = i.where // safe because the schema for `where` adds an empty object as default which is provided if the `where` field is absent
    const fields = this.getFields(whereObject, idRequired)
    return Builder.addFilters(fields, whereObject, deleteQuery)
  }

  private updateInternal(
    i: UpdateManyInput<any, any>,
    idRequired = false
  ): QueryBuilder {
    const query = squelPostgres
      .update()
      .table(this._tableName)
      .setFields(i.data)

    const whereObject = i.where // safe because the schema for `where` adds an empty object as default which is provided if the `where` field is absent
    const fields = this.getFields(whereObject, idRequired)
    return Builder.addFilters(fields, whereObject, query)
  }

  // TODO: add support for boolean conditions in where statement of FindInput<T>

  /**
   * Creates a `SELECT fields FROM table WHERE conditions` query.
   * @param i Object containing optional `where` and `selection` fields.
   * @param limit Maximum number of objects to retrieve.
   * @param offset Where to start in the table.
   * @param idRequired If true, will throw an error if no fields are provided in the `where` argument.
   */
  private findWhere(
    i: FindInput<any, any, any, any, any>,
    idRequired = false,
    selectWhereFields = true
  ): QueryBuilder {
    const whereObject = i.where
    const identificationFields = this.getFields(whereObject, idRequired)

    const query = squelPostgres.select().from(this._tableName) // specify from which table to select
    // only select the fields provided in `i.select` and the ones in `i.where`
    const addFieldSelection = this.addFieldSelection.bind(
      this,
      i,
      selectWhereFields ? identificationFields : []
    )
    // add a where clause to filter on the conditions provided in `i.where`
    const addFilters = Builder.addFilters.bind(
      null,
      identificationFields,
      whereObject
    )
    const addLimit = Builder.addLimit.bind(null, i)
    const addOffset = Builder.addOffset.bind(null, i)
    const addDistinct = Builder.addDistinct.bind(null, i)
    const addOrderBy = this.addOrderBy.bind(this, i)
    const buildQuery = flow(
      addFieldSelection,
      addFilters,
      addLimit,
      addOffset,
      addDistinct,
      addOrderBy
    )
    return buildQuery(query)
  }

  // Returns an array containing the names of the fields that are set to `true`
  private static getSelectedFields(obj: object): string[] {
    return Object.keys(obj).filter((key) => obj[key as keyof object])
  }

  private addFieldSelection(
    i: AnyFindInput,
    identificationFields: string[],
    q: PostgresSelect
  ): PostgresSelect {
    if (typeof i.select === 'undefined') {
      // Select all known fields explicitly
      // which is safer than executing a SELECT * query
      i.select = {}
      this._fields.forEach((field) => {
        i.select[field as keyof typeof i.select] = true
      })
    }

    const selectedFields = Builder.getSelectedFields(i.select!)
    if (selectedFields.length == 0)
      throw new InvalidArgumentError(
        `The \`select\` statement for type ${this._tableName} needs at least one truthy value.`
      )

    const fields = identificationFields.concat(selectedFields)
    return q.fields(fields)
  }

  private static addFilters<T, Q extends QueryBuilder & WhereMixin>(
    fields: string[],
    whereObject: T,
    q: Q
  ): Q {
    return fields.reduce<Q>((query: Q, fieldName: string) => {
      const fieldValue = whereObject[fieldName as keyof T]
      if (fieldValue === null) return query.where(`${fieldName} IS NULL`)
      else if (typeof fieldValue === 'object') {
        // an object containing filters is provided
        // e.g. users.findMany({ where: { id: in([1, 2, 3]) } })
        const filterSchema = z
          .object({
            in: z.any().array(),
          })
          .strict('Unsupported filter in where clause')
        // TODO: remove this schema check once we support all filters
        //       or remove the unsupported filters from the types and schemas that are generated from the Prisma schema

        const values = filterSchema.parse(fieldValue).in
        return query.where(`${fieldName} IN ?`, values)
      }
      // needed because `WHERE field = NULL` is not valid SQL
      else return query.where(`${fieldName} = ?`, [fieldValue])
    }, q)
  }

  private static addOffset(i: AnyFindInput, q: PostgresSelect): PostgresSelect {
    if (typeof i.skip === 'undefined') return q // no offset
    return q.offset(i.skip)
  }

  private static addLimit(i: AnyFindInput, q: PostgresSelect): PostgresSelect {
    if (typeof i.take === 'undefined') return q // no limit
    return q.limit(i.take)
  }

  private static addDistinct(
    i: AnyFindInput,
    q: PostgresSelect
  ): PostgresSelect {
    if (typeof i.distinct === 'undefined') return q
    return q.distinct(...i.distinct)
  }

  private addOrderBy(i: AnyFindInput, q: PostgresSelect): PostgresSelect {
    if (typeof i.orderBy === 'undefined') return q
    const orderByArray = Array.isArray(i.orderBy) ? i.orderBy : [i.orderBy]

    return orderByArray.reduce((query: PostgresSelect, orderBy: object) => {
      // Don't accept more than one field in `fieldOrdering` because we can't infer the order of those fields!
      // If we need to order on several fields, they should be provided as several OrderByInput objects in an array.
      const fields = Object.keys(orderBy)
      if (fields.length > 1)
        throw new InvalidArgumentError(
          `Argument 'orderBy' can have at most one field per 'OrderByInput' object. Consider providing several 'OrderByInput' objects in an array.`
        )
      if (fields.length === 0) return query

      const field = fields[0]
      const order = orderBy[field as keyof object]
      const squelOrder = order === 'asc' // squel expects 'true' for ascending order, 'false' for descending order
      return query.order(field, squelOrder)
    }, q)
  }

  private getFields(whereObject?: object, fieldsRequired = false) {
    const obj = typeof whereObject !== 'undefined' ? whereObject : {} // provide empty object if no `where` argument is provided
    const fields = Object.keys(obj)

    if (fieldsRequired && fields.length == 0)
      throw new InvalidArgumentError(
        `Argument \`where\` for query on ${this._tableName} type requires at least one argument.`
      )

    return fields
  }
}
