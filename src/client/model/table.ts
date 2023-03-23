import { CreateInput, CreateManyInput } from '../input/createInput'
import { FindInput, FindUniqueInput } from '../input/findInput'
import { ZObject } from '../validation/schemas'
import { Validation } from '../validation/validation'
import { UpdateInput, UpdateManyInput } from '../input/updateInput'
import { InputTypes } from '../input/input'
import { DeleteInput, DeleteManyInput } from '../input/deleteInput'
import { DatabaseAdapter } from '../../electric/adapter'
import { Builder } from './builder'
import { Executor } from '../execution/executor'
import { BatchPayload } from '../output/batchPayload'
import { InvalidArgumentError } from '../validation/errors/invalidArgumentError'
import { _NOT_UNIQUE_, _RECORD_NOT_FOUND_ } from '../validation/errors/messages'
import { UpsertInput } from '../input/upsertInput'
import { Selected } from '../util/types'
import { DB } from '../execution/db'
import { LiveResult, Model } from './model'
import { QualifiedTablename } from '../../util/tablename'
import { Notifier } from '../../notifiers'
import * as z from 'zod'
import { forEachCont } from '../util/continuationHelpers'

//////
type Relation = {
  relationName: string
  relationField: string
  fromField: string
  toField: string
  relatedTable: string
}

type TableName = string
type FieldName = string
type RelationName = string

interface DBDescription {
  getSchema(table: TableName): z.ZodSchema<any>
  getRelationName(table: TableName, field: FieldName): RelationName | undefined
  getRelation(table: TableName, relation: RelationName): Relation | undefined
  getRelations(table: TableName): Relation[] // TODO: DBDescription could take type of DbSchemas as type arg and then fetch the type that is associated to the tableName key out of it
  getOutgoingRelations(table: TableName): Relation[]
  getIncomingRelations(table: TableName): Relation[]
}
//////

// Data = typeof Prisma.UserCreateArgs.data
// Select = typeof Prisma.UserCreateArgs.select
// CreateArgs = Prisma.UserCreateArgs
export class Table<
    T extends Record<string, any>,
    CreateArgs extends CreateInput<any, any>,
    FindUniqueArgs extends FindUniqueInput<any, any>
  >
  extends Validation<T>
  implements Model<T>
{
  private _builder: Builder<T>
  private _executor: Executor<T>
  private _qualifiedTableName: QualifiedTablename
  private _tables: Map<TableName, Table<any, any, any>>

  constructor(
    tableName: string,
    schema: ZObject<T>,
    adapter: DatabaseAdapter,
    notifier: Notifier,
    private createSchema: z.ZodType<CreateArgs>,
    private findUniqueSchema: z.ZodType<FindUniqueArgs>,
    private _dbDescription: DBDescription
  ) {
    super(tableName, schema)
    const fields = Object.keys(this._schema.shape)
    this._builder = new Builder<T>(tableName, fields)
    this._executor = new Executor<T>(adapter, schema, notifier)
    this._qualifiedTableName = new QualifiedTablename('main', tableName)
    this._tables = new Map()
  }

  setTables(tables: Map<TableName, Table<any, any, any>>) {
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

  async create<Input extends CreateArgs>(
    i: Input //Prisma.SelectSubset<T, Input>
  ): Promise<Selected<T, Input>> {
    // TODO: also use Prisma's generated return type? <Table>GetPayload<Input>
    // We have to typecast it because internally when querying the DB we get back a Partial<T>
    // But since we carefully craft the queries we know that only the selected fields are in that object
    return this._executor.transaction(
      this._create.bind(this, i)
    ) as unknown as Promise<Selected<T, Input>>
  }

  async createMany(i: CreateManyInput<T[]>): Promise<BatchPayload> {
    return this._executor.execute(this._createMany(i))
  }

  async findUnique<Input extends FindUniqueInput<any, any>>(
    i: Input
  ): Promise<Selected<T, Input> | null> {
    return this._executor.execute(
      this._findUnique.bind(this, i),
      false
    ) as unknown as Promise<Selected<T, Input> | null>
  }

  liveUnique<Input extends FindUniqueInput<any, any>>(
    i: Input
  ): () => Promise<LiveResult<Selected<T, Input> | null>> {
    return this.makeLiveResult(this.findUnique(i))
  }

  async findFirst<Input extends FindInput<T>>(
    i: Input
  ): Promise<Selected<T, Input> | null> {
    return this._executor.execute(
      this._findFirst(i),
      false
    ) as unknown as Promise<Selected<T, Input> | null>
  }

  liveFirst<Input extends FindInput<T>>(
    i: Input
  ): () => Promise<LiveResult<Selected<T, Input> | null>> {
    return this.makeLiveResult(this.findFirst(i))
  }

  async findMany<Input extends FindInput<T>>(
    i: Input
  ): Promise<Array<Selected<T, Input>>> {
    return this._executor.execute(
      this._findMany(i),
      false
    ) as unknown as Promise<Array<Selected<T, Input>>>
  }

  liveMany<Input extends FindInput<T>>(
    i: Input
  ): () => Promise<LiveResult<Array<Selected<T, Input>>>> {
    return this.makeLiveResult(this.findMany(i))
  }

  // TODO: see if we can enforce a unique a argument in `where` such that we are sure we identify 0 or max 1 record to update
  //       this information will need to be extracted from the schema (we already do a runtime check)
  async update<Input extends UpdateInput<T>>(
    i: Input
  ): Promise<Selected<T, Input>> {
    return this._executor.transaction(
      this._update.bind(this, i)
    ) as unknown as Promise<Selected<T, Input>>
  }

  async updateMany(i: UpdateManyInput<T>): Promise<BatchPayload> {
    return this._executor.execute(this._updateMany.bind(this, i))
  }

  async upsert<Input extends UpsertInput<T>>(
    i: Input
  ): Promise<Selected<T, Input>> {
    return this._executor.transaction(
      this._upsert.bind(this, i)
    ) as unknown as Promise<Selected<T, Input>>
  }

  async delete<Input extends DeleteInput<T>>(
    i: Input
  ): Promise<Selected<T, Input>> {
    return this._executor.transaction(
      this._delete.bind(this, i)
    ) as unknown as Promise<Selected<T, Input>>
  }

  async deleteMany(i: DeleteManyInput<T>): Promise<BatchPayload> {
    return this._executor.execute(this._deleteMany.bind(this, i))
  }

  protected _create(
    i: CreateArgs,
    db: DB<T>,
    continuation: (record: Partial<T>) => void,
    onError: (err: any) => void
  ) {
    const validatedInput = Validation.validateInternal(i, this.createSchema)
    const data = validatedInput.data

    /*
     * For each outgoing relation with a provided relation field:
     *  - fetch the object in the relation field and recursively create that object
     *  - remember to fill in the FK (i.e. assign the createdObject.toField to fromField in the object we will create)
     *  - remove this relation field from the object we will create
     */

    const outgoingRelations = this._dbDescription.getOutgoingRelations(
      this._tableName
    )

    forEachCont((rel: Relation, cont: () => void) => {
      const { fromField, toField, relationField, relatedTable } = rel
      if (Object.hasOwn(data, relationField)) {
        // this relation field is present
        // fetch the object in the relation field and recursively create that object
        const relatedObject = data[relationField].create
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
    }, outgoingRelations)

    /*
     * For each incoming relation:
     *  - remove the relation field from this object
     *  - remember to create the related object and fill in the `toField` of the object we will create as the FK `fromField` of the related object
     */

    const incomingRelations = this._dbDescription.getIncomingRelations(
      this._tableName
    )
    let makeRelatedObjects: (obj: object) => void = () => undefined

    function createRelatedObject(rel: Relation, relatedObject: object) {
      const { relationField, relatedTable, relationName } = rel
      // remove this relation field
      delete data[relationField]
      // create the related object and fill in the FK
      // i.e. fill in the `fromField` on the related object using this object's `toField`
      const oldMakeRelatedObjects = makeRelatedObjects
      makeRelatedObjects = (obj: object) => {
        const relatedTbl = this._tables.get(relatedTable)
        const { fromField, toField } = this._dbDescription.getRelation(
          relatedTable,
          relationName
        ) // the `fromField` and `toField` are defined on the side of the outgoing relation
        // Create the related object
        relatedObject[fromField] = obj[toField] // fill in FK
        relatedTbl._create(
          { data: relatedObject },
          db,
          () => {
            oldMakeRelatedObjects(obj)
          },
          onError
        )
      }
    }

    forEachCont((rel: Relation, cont: () => void) => {
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
      cont()
    }, incomingRelations)

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

        const insertedObject = insertedObjects[0]
        makeRelatedObjects(insertedObject)

        // Now read the record that was inserted
        // need to read it because some fields could be auto-generated
        // it would be enough to select on a unique ID, but we don't know which field(s) is the unique ID
        // hence, for now `findCreated` filters on all the values that are provided in `validatedInput.data`
        this._findUniqueWithoutAutoSelect(
          {
            where: data as any,
            select: validatedInput.select as any,
          },
          db,
          continuation,
          onError,
          'Create'
        )
      },
      onError
    )
  }

  private _createMany(i: CreateManyInput<T[]>) {
    return (
      db: DB<T>,
      continuation: (res: BatchPayload) => void,
      onError: (err: any) => void
    ) => {
      const data = this.validate(i, InputTypes.CreateMany)
      const sql = this._builder.createMany(data)
      db.run(
        sql,
        (_, { rowsAffected }) => {
          continuation({ count: rowsAffected })
        },
        onError
      )
    }
  }

  // TODO: should specify at least one unique field and potentially some other fields in T
  //       but this requires knowledge about which type T is, to know the unique fields, in order to be able to express it using Pick
  //       so then we need to compile that code like prisma does with its client
  //       --> We could then compile the table class to be e.g. `PostTable` and replace every `T` by Post and use here `Pick<Post, 'id'> & Partial<Post>`
  //       --> not necessarily, we could also take the interface as an additional type argument `U extends Partial<T>` and U is basically T but with non-unique fields made optional
  private _findUnique(
    i: FindUniqueInput<any, any>,
    db: DB<T>,
    continuation: (res: Partial<T> | null) => void,
    onError: (err: any) => void
  ) {
    // Note: `findUnique` differs from Prisma. In Prisma it requires to provide at least one unique field on which to search.
    //       We can't enforce that because we don't know what the unique fields of T are. This information would have to be generated from the Prisma schema.
    const data = Validation.validateInternal(i, this.findUniqueSchema)
    const sql = this._builder.findUnique(data)
    db.query(
      sql,
      this._schema,
      (_, res) => {
        if (res.length > 1) throw new InvalidArgumentError(_NOT_UNIQUE_)
        if (res.length === 1)
          return continuation(res[0] as unknown as Partial<T>)
        return continuation(null)
      },
      onError
    )
  }

  private _findFirst(i: FindInput<T>) {
    return (
      db: DB<T>,
      continuation: (res: Partial<T> | null) => void,
      onError: (err: any) => void
    ) => {
      const data = this.validate(i, InputTypes.Find)
      const sql = this._builder.findFirst(data)
      db.query(
        sql,
        this._schema,
        (_, res) => {
          if (res.length == 0) return continuation(null)
          return continuation(res[0] as unknown as Partial<T>)
        },
        onError
      )
    }
  }

  private _findMany(i: FindInput<T>) {
    return (
      db: DB<T>,
      continuation: (res: Partial<T>[]) => void,
      onError: (err: any) => void
    ) => {
      const data = this.validate(i, InputTypes.Find)
      const sql = this._builder.findMany(data)
      db.query(
        sql,
        this._schema,
        (_, res) => {
          continuation(res)
        },
        onError
      )
    }
  }

  private _findUniqueWithoutAutoSelect(
    i: FindInput<T>,
    db: DB<T>,
    continuation: (res: Partial<T>) => void,
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
        const [obj] = rows
        return continuation(obj)
      },
      onError
    )
  }

  private _update(
    i: UpdateInput<T>,
    db: DB<T>,
    continuation: (res: Partial<T>) => void,
    onError: (err: any) => void
  ) {
    const data = this.validate(i, InputTypes.Update)

    // Find the record and make sure it is unique
    this._findUnique(
      { where: data.where },
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
              },
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

  private _updateMany(
    i: UpdateManyInput<T>,
    db: DB<T>,
    continuation: (res: BatchPayload) => void,
    onError: (err: any) => void
  ) {
    const data = this.validate(i, InputTypes.UpdateMany)
    const sql = this._builder.updateMany(data)
    db.run(
      sql,
      (_, { rowsAffected }) => {
        return continuation({ count: rowsAffected })
      },
      onError
    )
  }

  private _upsert(
    i: UpsertInput<T>,
    db: DB<T>,
    continuation: (res: Partial<T>) => void,
    onError: (err: any) => void
  ) {
    const data = this.validate(i, InputTypes.Upsert)
    // Check if the record exists
    this._findUnique(
      { where: i.where },
      db,
      (rows) => {
        if (rows === null) {
          // Create the record
          return this._create(
            {
              data: data.create as unknown as Data,
              select: data.select as Select,
            } as CreateArgs,
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
            },
            db,
            continuation,
            onError
          )
        }
      },
      onError
    )
  }

  private _delete(
    i: DeleteInput<T>,
    db: DB<T>,
    continuation: (res: Partial<T>) => void,
    onError: (err: any) => void
  ) {
    const data = this.validate(i, InputTypes.Delete)
    // Check that the record exists
    this._findUniqueWithoutAutoSelect(
      data,
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

  private _deleteMany(
    i: DeleteManyInput<T>,
    db: DB<T>,
    continuation: (res: BatchPayload) => void,
    onError: (err: any) => void
  ) {
    const data = this.validate(i, InputTypes.DeleteMany)
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
