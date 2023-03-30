import { CreateInput, CreateManyInput } from '../input/createInput'
import { FindInput, FindUniqueInput } from '../input/findInput'
import { validate } from '../validation/validation'
import { UpdateInput, UpdateManyInput } from '../input/updateInput'
import { DeleteInput, DeleteManyInput } from '../input/deleteInput'
import { DatabaseAdapter } from '../../electric/adapter'
import { Builder } from './builder'
import { Executor } from '../execution/executor'
import { BatchPayload } from '../output/batchPayload'
import { InvalidArgumentError } from '../validation/errors/invalidArgumentError'
import { _NOT_UNIQUE_, _RECORD_NOT_FOUND_ } from '../validation/errors/messages'
import { UpsertInput } from '../input/upsertInput'
import { SelectSubset } from '../util/types'
import { DB } from '../execution/db'
import { LiveResult, Model } from './model'
import { QualifiedTablename } from '../../util/tablename'
import { Notifier } from '../../notifiers'
import { forEach } from '../util/continuationHelpers'
import { Arity, DBDescription, Relation, TableName } from './dbDescription'
import { Kind, URIS } from 'fp-ts/HKT'
import * as z from 'zod'

// TODO: Document the fact that we support one-to-one, one-to-many, and explicit many-to-many relations
//       Explicit many-to-many relations consist of an intermediate table that contains 2 one-to-many relations
//       which together form the many-to-many relation. So many-to-many is supported by virtue of us supporting one-to-many.
//       Implicit many-to-many relations as in Prisma is currently not supported.
//       https://www.prisma.io/docs/concepts/components/prisma-schema/relations/many-to-many-relations

type AnyTable = Table<any, any, any, any, any, any, any, any, any, URIS>

export class Table<
  T extends Record<string, any>,
  CreateData extends object,
  UpdateData,
  Select,
  Where,
  WhereUnique,
  Include extends Record<string, any>,
  OrderBy,
  ScalarFieldEnum,
  GetPayload extends URIS
> implements
    Model<
      CreateData,
      UpdateData,
      Select,
      Where,
      WhereUnique,
      Include,
      OrderBy,
      ScalarFieldEnum,
      GetPayload
    >
{
  private _builder: Builder
  private _executor: Executor
  private _qualifiedTableName: QualifiedTablename
  private _tables: Map<TableName, AnyTable>

  constructor(
    public tableName: string,
    private _schema: z.ZodType<Partial<T>>,
    adapter: DatabaseAdapter,
    notifier: Notifier,
    private _dbDescription: DBDescription,
    private createSchema: z.ZodType<CreateInput<CreateData, Select, Include>>,
    private createManySchema: z.ZodType<CreateManyInput<CreateData>>,
    private findUniqueSchema: z.ZodType<
      FindUniqueInput<Select, WhereUnique, Include>
    >,
    private findSchema: z.ZodType<
      FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
    >,
    private updateSchema: z.ZodType<
      UpdateInput<UpdateData, Select, WhereUnique, Include>
    >,
    private updateManySchema: z.ZodType<UpdateManyInput<UpdateData, Where>>,
    private upsertSchema: z.ZodType<
      UpsertInput<CreateData, UpdateData, Select, WhereUnique, Include>
    >,
    private deleteSchema: z.ZodType<DeleteInput<Select, WhereUnique, Include>>,
    private deleteManySchema: z.ZodType<DeleteManyInput<Where>>
  ) {
    this._builder = new Builder(
      tableName,
      this._dbDescription.getFields(tableName)
    )
    this._executor = new Executor(adapter, notifier)
    this._qualifiedTableName = new QualifiedTablename('main', tableName)
    this._tables = new Map()
  }

  setTables(tables: Map<TableName, AnyTable>) {
    this._tables = tables
  }

  /*
   * The API is implemented in continuation passing style.
   * Private methods return a function expecting 2 arguments:
   *   1. a transaction
   *   2. a continuation
   * These methods will then execute their query inside the provided transaction and pass the result to the continuation.
   * As such, one can compose these methods arbitrarily and then run them inside a single transaction.
   */

  async create<T extends CreateInput<CreateData, Select, Include>>(
    i: SelectSubset<T, CreateInput<CreateData, Select, Include>>
  ): Promise<Kind<GetPayload, T>> {
    // a higher kinded type GetPayload<T>
    // We have to typecast it because internally when querying the DB we get back a Partial<T>
    // But since we carefully craft the queries we know that only the selected fields are in that object
    return this._executor.transaction(this._create.bind(this, i))
  }

  async createMany<T extends CreateManyInput<CreateData>>(
    i: SelectSubset<T, CreateManyInput<CreateData>>
  ): Promise<BatchPayload> {
    return this._executor.execute(this._createMany.bind(this, i))
  }

  async findUnique<T extends FindUniqueInput<Select, WhereUnique, Include>>(
    i: SelectSubset<T, FindUniqueInput<Select, WhereUnique, Include>>
  ): Promise<Kind<GetPayload, T> | null> {
    return this._executor.execute(this._findUnique.bind(this, i), false)
  }

  liveUnique<T extends FindUniqueInput<Select, WhereUnique, Include>>(
    i: SelectSubset<T, FindUniqueInput<Select, WhereUnique, Include>>
  ): () => Promise<LiveResult<Kind<GetPayload, T> | null>> {
    return this.makeLiveResult(this.findUnique(i))
  }

  async findFirst<
    T extends FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
  >(
    i: SelectSubset<
      T,
      FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
    >
  ): Promise<Kind<GetPayload, T> | null> {
    return this._executor.execute(this._findFirst.bind(this, i), false)
  }

  liveFirst<
    T extends FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
  >(
    i: SelectSubset<
      T,
      FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
    >
  ): () => Promise<LiveResult<Kind<GetPayload, T> | null>> {
    return this.makeLiveResult(this.findFirst(i))
  }

  async findMany<
    T extends FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
  >(
    i: SelectSubset<
      T,
      FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
    >
  ): Promise<Array<Kind<GetPayload, T>>> {
    return this._executor.execute(this._findMany.bind(this, i), false)
  }

  liveMany<
    T extends FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
  >(
    i: SelectSubset<
      T,
      FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
    >
  ): () => Promise<LiveResult<Array<Kind<GetPayload, T>>>> {
    return this.makeLiveResult(this.findMany(i))
  }

  async update<T extends UpdateInput<UpdateData, Select, WhereUnique, Include>>(
    i: SelectSubset<T, UpdateInput<UpdateData, Select, WhereUnique, Include>>
  ): Promise<Kind<GetPayload, T>> {
    return this._executor.transaction(this._update.bind(this, i))
  }

  async updateMany<T extends UpdateManyInput<UpdateData, Where>>(
    i: SelectSubset<T, UpdateManyInput<UpdateData, Where>>
  ): Promise<BatchPayload> {
    return this._executor.execute(this._updateMany.bind(this, i))
  }

  async upsert<
    T extends UpsertInput<CreateData, UpdateData, Select, WhereUnique, Include>
  >(
    i: SelectSubset<
      T,
      UpsertInput<CreateData, UpdateData, Select, WhereUnique, Include>
    >
  ): Promise<Kind<GetPayload, T>> {
    return this._executor.transaction(this._upsert.bind(this, i))
  }

  async delete<T extends DeleteInput<Select, WhereUnique, Include>>(
    i: SelectSubset<T, DeleteInput<Select, WhereUnique, Include>>
  ): Promise<Kind<GetPayload, T>> {
    return this._executor.transaction(this._delete.bind(this, i))
  }

  async deleteMany<T extends DeleteManyInput<Where>>(
    i: SelectSubset<T, DeleteManyInput<Where>>
  ): Promise<BatchPayload> {
    return this._executor.execute(this._deleteMany.bind(this, i))
  }

  protected _create<T extends CreateInput<CreateData, Select, Include>>(
    i: SelectSubset<T, CreateInput<CreateData, Select, Include>>,
    db: DB,
    continuation: (record: Kind<GetPayload, T>) => void,
    onError: (err: any) => void
  ) {
    const validatedInput = validate(i, this.createSchema)
    const data = validatedInput.data as Record<string, any>

    /*
     * For each outgoing relation with a provided relation field:
     *  - fetch the object in the relation field and recursively create that object
     *  - remember to fill in the FK (i.e. assign the createdObject.toField to fromField in the object we will create)
     *  - remove this relation field from the object we will create
     */

    const outgoingRelations = this._dbDescription.getOutgoingRelations(
      this.tableName
    )

    forEach(
      (rel: Relation, cont: () => void) => {
        const { fromField, toField, relationField, relatedTable } = rel
        if (Object.hasOwn(data, relationField)) {
          // this relation field is present
          // fetch the object in the relation field and recursively create that object
          const relatedObject = (data[relationField] as { create: object })
            .create
          // TODO: return an error if user provided a createMany, connect, connectOrCreate
          //       the former will not be supported because you can pass an array of related objects to `create`
          //       the latter 2 should eventually be implemented at some point

          const relatedTbl = this._tables.get(relatedTable)!
          relatedTbl._create(
            { data: relatedObject },
            db,
            (createdRelatedObject) => {
              delete data[relationField] // remove the relation field
              data[fromField] = createdRelatedObject[toField] // fill in the FK
              cont()
            },
            onError
          )
        } else {
          cont()
        }
      },
      outgoingRelations,
      () => {
        // Once, we created the related objects above,
        // we continue and handle the incoming relations.

        /*
         * For each incoming relation:
         *  - remove the relation field from this object
         *  - remember to create the related object and fill in the `toField` of the object we will create as the FK `fromField` of the related object
         */

        const incomingRelations = this._dbDescription.getIncomingRelations(
          this.tableName
        )

        // below `createRelatedObject` reassigns this variable with a function that wraps this one
        // each wrapper creates an object and calls the wrapped function
        // at the end, the function below will be called which will call the continuation
        let makeRelatedObjects: (obj: object, cont: () => void) => void = (
          _obj,
          cont: () => void
        ) => cont()

        const createRelatedObject = (
          rel: Relation,
          relatedObject: Record<string, any>
        ) => {
          const { relationField, relatedTable, relationName } = rel
          // remove this relation field
          delete data[relationField]
          // create the related object and fill in the FK
          // i.e. fill in the `fromField` on the related object using this object's `toField`
          const oldMakeRelatedObjects = makeRelatedObjects
          makeRelatedObjects = (obj: Record<string, any>, cont: () => void) => {
            const relatedTbl = this._tables.get(relatedTable)!
            // the `fromField` and `toField` are defined on the side of the outgoing relation
            const { fromField, toField } = this._dbDescription.getRelation(
              relatedTable,
              relationName
            )!
            // Create the related object
            relatedObject[fromField] = obj[toField] // fill in FK
            relatedTbl._create(
              { data: relatedObject },
              db,
              () => {
                oldMakeRelatedObjects(obj, cont)
              },
              onError
            )
          }
        }

        incomingRelations.forEach((rel: Relation) => {
          const { relationField } = rel
          if (Object.hasOwn(data, relationField)) {
            const relatedObjects = data[relationField].create
            if (Array.isArray(relatedObjects)) {
              // this is a one-to-many relation
              // create all the related objects
              relatedObjects.forEach(createRelatedObject.bind(this, rel))
            } else {
              // this is a one-to-one relation
              // create the related object
              createRelatedObject(rel, relatedObjects)
            }
          }
        })

        /*
         * Now create the object and then:
         *  - create the related objects for the incoming relations
         */

        // Make a SQL query out of the parsed data
        const createQuery = this._builder.create({
          ...validatedInput,
          data: data,
        })

        db.query(
          createQuery,
          this._schema,
          (db, insertedObjects) => {
            if (insertedObjects.length !== 1)
              onError('Wrong amount of objects were created.')

            // Now, create the related objects
            const insertedObject = insertedObjects[0]
            makeRelatedObjects(insertedObject, () => {
              // Now read the record that was inserted
              // need to read it because some fields could be auto-generated
              // it would be enough to select on a unique ID, but we don't know which field(s) is the unique ID
              // hence, for now `findCreated` filters on all the values that are provided in `validatedInput.data`
              this._findUniqueWithoutAutoSelect(
                {
                  where: data,
                  select: validatedInput.select,
                  include: validatedInput.include,
                } as any,
                db,
                continuation,
                onError,
                'Create'
              )
            })
          },
          onError
        )
      }
    )
  }

  private _createMany<T extends CreateManyInput<CreateData>>(
    i: SelectSubset<T, CreateManyInput<CreateData>>,
    db: DB,
    continuation: (res: BatchPayload) => void,
    onError: (err: any) => void
  ) {
    const data = validate(i, this.createManySchema)
    const sql = this._builder.createMany(data)
    db.run(
      sql,
      (_, { rowsAffected }) => {
        continuation({ count: rowsAffected })
      },
      onError
    )
  }

  private _findUnique<T extends FindUniqueInput<Select, WhereUnique, Include>>(
    i: SelectSubset<T, FindUniqueInput<Select, WhereUnique, Include>>,
    db: DB,
    continuation: (res: Kind<GetPayload, T> | null) => void,
    onError: (err: any) => void
  ) {
    const data = validate(i, this.findUniqueSchema)
    const sql = this._builder.findUnique(data)
    db.query(
      sql,
      this._schema,
      (_, res) => {
        if (res.length > 1) throw new InvalidArgumentError(_NOT_UNIQUE_)
        if (res.length === 1)
          return this.fetchIncludes(
            res as Kind<GetPayload, T>[],
            data.include,
            db,
            (rows) => {
              continuation(rows[0])
            },
            onError
          )
        return continuation(null)
      },
      onError
    )
  }

  private _findFirst<
    T extends FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
  >(
    i: SelectSubset<
      T,
      FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
    >,
    db: DB,
    continuation: (res: Kind<GetPayload, T> | null) => void,
    onError: (err: any) => void
  ) {
    const data = validate(i, this.findSchema)
    const sql = this._builder.findFirst(data)
    db.query(
      sql,
      this._schema,
      (_, res) => {
        if (res.length == 0) return continuation(null)
        return this.fetchIncludes(
          [res[0]] as Kind<GetPayload, T>[],
          data.include,
          db,
          (rows) => {
            continuation(rows[0])
          },
          onError
        )
      },
      onError
    )
  }

  /**
   * Joins objects in `rows` with objects in `relatedRows` where `row.fromField === relatedRow.toField`.
   * Beware: this function mutates the objects in `rows`.
   * @param rows Array of original objects
   * @param relatedRows Array of related objects
   * @param fromField Field of objects in `rows` that points to related object.
   * @param toField Field of objects in `relatedRows` that is pointed at by the original object.
   */
  private joinObjects(
    rows: Array<Record<string, any>>,
    relatedRows: Array<Record<string, any>>,
    fromField: string,
    toField: string,
    relationField: string,
    relationArity: Arity
  ) {
    return rows.map((row) => {
      const relatedObjects = relatedRows.filter(
        (r) => row[fromField] == r[toField]
      )
      if (relatedObjects.length === 0) return row
      else if (relationArity === 'one') {
        if (relatedObjects.length > 1)
          throw TypeError(
            `Relation on field '${relationField}' is one-to-one but found several related objects: ` +
              JSON.stringify(relatedObjects)
          )
        // one-to-one or one-to-many relation and we fetched the related object on the one side.
        // so we assign the related object to `relationField`
        const [relatedObject] = relatedObjects
        return Object.assign(row, {
          [relationField]: relatedObject,
        })
      } else {
        // one-to-many relation and we fetched the related objects on the many side
        // so we assign the array of related objects to `relationField`
        return Object.assign(row, {
          [relationField]: relatedObjects,
        })
      }
    })
  }

  private fetchRelated(
    rows: Kind<GetPayload, T>[],
    relatedTable: string,
    fromField: string,
    toField: string,
    relationField: string,
    relationType: Arity,
    includeArg: true | FindInput<any, any, any, any, any>,
    db: DB,
    onResult: (joinedRows: Kind<GetPayload, T>[]) => void,
    onError: (err: any) => void
  ) {
    const otherTable = this._tables.get(relatedTable)!
    const args = includeArg === true ? {} : includeArg
    const where = typeof args.where === 'undefined' ? {} : args.where
    const foreignKeys = rows.map((row) => row[fromField as keyof typeof row])
    otherTable._findMany(
      {
        ...args,
        where: {
          ...where,
          [toField]: {
            in: foreignKeys,
          },
        },
      },
      db,
      (relatedRows: object[]) => {
        // Now, join the original `rows` with the `relatedRows`
        // where `row.fromField == relatedRow.toField`
        const join = this.joinObjects(
          rows,
          relatedRows,
          fromField,
          toField,
          relationField,
          relationType
        ) as Kind<GetPayload, T>[]
        onResult(join)
      },
      onError
    )
  }

  private fetchInclude(
    rows: Kind<GetPayload, T>[],
    relation: Relation,
    includeArg: boolean | FindInput<any, any, any, any, any>,
    db: DB,
    onResult: (rows: Kind<GetPayload, T>[]) => void,
    onError: (err: any) => void
  ) {
    if (includeArg === false) {
      return onResult([])
    } else if (relation.isIncomingRelation()) {
      // incoming relation
      const { fromField, toField } = relation.getOppositeRelation(
        this._dbDescription
      )
      this.fetchRelated(
        rows,
        relation.relatedTable,
        toField,
        fromField,
        relation.relationField,
        relation.relatedObjects,
        includeArg,
        db,
        onResult,
        onError
      )
    } else {
      // outgoing relation from the `fromField` in this table
      // to the `toField` in `relatedTable`
      const {
        fromField,
        toField,
        relationField,
        relatedObjects,
        relatedTable,
      } = relation
      this.fetchRelated(
        rows,
        relatedTable,
        fromField,
        toField,
        relationField,
        relatedObjects,
        includeArg,
        db,
        onResult,
        onError
      )
    }
  }

  private fetchIncludes(
    rows: Kind<GetPayload, T>[],
    include: Include | undefined,
    db: DB,
    onResult: (res: Kind<GetPayload, T>[]) => void,
    onError: (err: any) => void
  ) {
    if (typeof include === 'undefined' || rows.length === 0)
      return onResult(rows)
    else {
      const relationFields = Object.keys(include)
      let includedRows: Kind<GetPayload, T>[] = []
      // TODO: everywhere we use forEachCont we probably don't need continuation passing style!
      //       so try to remove it there and then rename this one to `forEachCont`
      forEach(
        (relationField: string, cont: () => void) => {
          const relationName = this._dbDescription.getRelationName(
            this.tableName,
            relationField
          )!
          const relation = this._dbDescription.getRelation(
            this.tableName,
            relationName
          )

          if (typeof relation === 'undefined')
            throw TypeError(
              'Unexpected field `' + relationField + '` in `include` argument.'
            )

          this.fetchInclude(
            rows,
            relation,
            include[relationField],
            db,
            (fetchedRows) => {
              includedRows = includedRows.concat(fetchedRows)
              cont()
            },
            onError
          )
        },
        relationFields,
        () => {
          // once the loop finished, call `onResult`
          onResult(includedRows)
        }
      )
    }
  }

  private _findMany<
    T extends FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
  >(
    i: SelectSubset<
      T,
      FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
    >,
    db: DB,
    continuation: (res: Kind<GetPayload, T>[]) => void,
    onError: (err: any) => void
  ) {
    const data = validate(i, this.findSchema)
    const sql = this._builder.findMany(data)
    db.query(
      sql,
      this._schema,
      (_, rows) => {
        this.fetchIncludes(
          rows as Kind<GetPayload, T>[],
          data.include,
          db,
          continuation,
          onError
        )
      },
      onError
    )
  }

  private _findUniqueWithoutAutoSelect<
    T extends FindUniqueInput<Select, WhereUnique, Include>
  >(
    i: SelectSubset<T, FindUniqueInput<Select, WhereUnique, Include>>,
    db: DB,
    continuation: (res: Kind<GetPayload, T>) => void,
    onError: (err: any) => void,
    queryType: string
  ) {
    const q = this._builder.findWithoutAutoSelect(i)
    db.query(
      q,
      this._schema,
      (_, rows) => {
        if (rows.length === 0)
          throw new InvalidArgumentError(_RECORD_NOT_FOUND_(queryType))
        if (rows.length > 1) throw new InvalidArgumentError(_NOT_UNIQUE_)

        // Fetch the related objects requested by the `include` argument
        this.fetchIncludes(
          rows as Array<Kind<GetPayload, T>>,
          i.include,
          db,
          (joinedRows) => {
            const [joinedObj] = joinedRows
            continuation(joinedObj)
          },
          onError
        )
      },
      onError
    )
  }

  private _update<
    T extends UpdateInput<UpdateData, Select, WhereUnique, Include>
  >(
    i: SelectSubset<T, UpdateInput<UpdateData, Select, WhereUnique, Include>>,
    db: DB,
    continuation: (res: Kind<GetPayload, T>) => void,
    onError: (err: any) => void
  ) {
    const data = validate(i, this.updateSchema)

    // Find the record and make sure it is unique
    this._findUnique(
      { where: data.where } as any,
      db,
      (rows) => {
        if (rows === null)
          throw new InvalidArgumentError(_RECORD_NOT_FOUND_('Update'))

        // Update the record
        const updateDataQuery = this._builder.update(data)
        db.run(
          updateDataQuery,
          (db) => {
            this._findUniqueWithoutAutoSelect(
              {
                where: { ...data.where, ...data.data },
                select: data.select,
                include: data.include,
              } as any,
              db,
              continuation,
              onError,
              'Update'
            )
          },
          onError
        )
      },
      onError
    )
  }

  private _updateMany<T extends UpdateManyInput<UpdateData, Where>>(
    i: SelectSubset<T, UpdateManyInput<UpdateData, Where>>,
    db: DB,
    continuation: (res: BatchPayload) => void,
    onError: (err: any) => void
  ) {
    const data = validate(i, this.updateManySchema)
    const sql = this._builder.updateMany(data)
    db.run(
      sql,
      (_, { rowsAffected }) => {
        return continuation({ count: rowsAffected })
      },
      onError
    )
  }

  private _upsert<
    T extends UpsertInput<CreateData, UpdateData, Select, WhereUnique, Include>
  >(
    i: SelectSubset<
      T,
      UpsertInput<CreateData, UpdateData, Select, WhereUnique, Include>
    >,
    db: DB,
    continuation: (res: Kind<GetPayload, T>) => void,
    onError: (err: any) => void
  ) {
    const data = validate(i, this.upsertSchema)
    // Check if the record exists
    this._findUnique(
      { where: i.where } as any,
      db,
      (rows) => {
        if (rows === null) {
          // Create the record
          return this._create(
            {
              data: data.create,
              select: data.select,
              include: data.include,
            } as any,
            db,
            continuation,
            onError
          )
        } else {
          // Update the record
          return this._update(
            {
              data: data.update,
              where: data.where,
              select: data.select,
              include: data.include,
            } as any,
            db,
            continuation,
            onError
          )
        }
      },
      onError
    )
  }

  private _delete<T extends DeleteInput<Select, WhereUnique, Include>>(
    i: SelectSubset<T, DeleteInput<Select, WhereUnique, Include>>,
    db: DB,
    continuation: (res: Kind<GetPayload, T>) => void,
    onError: (err: any) => void
  ) {
    const data = validate(i, this.deleteSchema)
    // Check that the record exists
    this._findUniqueWithoutAutoSelect(
      data as any,
      db,
      (record) => {
        // Delete it and return the deleted record
        const deleteQuery = this._builder.delete(data)
        db.run(deleteQuery, () => continuation(record), onError)
      },
      onError,
      'Delete'
    )
  }

  private _deleteMany<T extends DeleteManyInput<Where>>(
    i: SelectSubset<T, DeleteManyInput<Where>>,
    db: DB,
    continuation: (res: BatchPayload) => void,
    onError: (err: any) => void
  ) {
    const data = validate(i, this.deleteManySchema)
    const sql = this._builder.deleteMany(data)
    db.run(
      sql,
      (_, { rowsAffected }) => {
        continuation({ count: rowsAffected })
      },
      onError
    )
  }

  private makeLiveResult<T>(prom: Promise<T>): () => Promise<LiveResult<T>> {
    return () => {
      return prom.then((res) => {
        return new LiveResult(res, [this._qualifiedTableName])
      }) as Promise<LiveResult<T>>
    }
  }
}
