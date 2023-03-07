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
import { Model } from './model'
import { QualifiedTablename } from '../../util/tablename'
import { LiveQueries } from './liveQueries'
import { Notifier } from '../../notifiers'

export { buildDalNamespace } from './dalNamespace'

export class Table<T extends Record<string, any>>
  extends Validation<T>
  implements Model<T>
{
  private _builder: Builder<T>
  private _executor: Executor<T>
  private _qualifiedTableName: QualifiedTablename

  public live: LiveQueries<T>

  constructor(
    tableName: string,
    schema: ZObject<T>,
    adapter: DatabaseAdapter,
    notifier: Notifier
  ) {
    super(tableName, schema)
    this._builder = new Builder<T>(tableName)
    this._executor = new Executor<T>(adapter, schema, notifier)
    this._qualifiedTableName = new QualifiedTablename('main', tableName)
    this.live = new LiveQueries(this, this._qualifiedTableName)
  }

  /*
   * The API is implemented in continuation passing style.
   * Private methods return a function expecting 2 arguments:
   *   1. a transaction
   *   2. a continuation
   * These methods will then execute their query inside the provided transaction and pass the result to the continuation.
   * As such, one can compose these methods arbitrarily and then run them inside a single transaction.
   */

  async create<Input extends CreateInput<T>>(
    i: Input
  ): Promise<Selected<T, Input>> {
    // We have to typecast it because internally when querying the DB we get back a Partial<T>
    // But since we carefully craft the queries we know that only the selected fields are in that object
    return this._executor.transaction(
      this._create.bind(this, i)
    ) as unknown as Promise<Selected<T, Input>>
  }

  async createMany(i: CreateManyInput<T[]>): Promise<BatchPayload> {
    return this._executor.execute(this._createMany(i))
  }

  async findUnique<Input extends FindUniqueInput<T>>(
    i: Input
  ): Promise<Selected<T, Input> | null> {
    return this._executor.execute(
      this._findUnique.bind(this, i)
    ) as unknown as Promise<Selected<T, Input> | null>
  }

  async findFirst<Input extends FindInput<T>>(
    i: Input
  ): Promise<Selected<T, Input> | null> {
    return this._executor.execute(
      this._findFirst(i)
    ) as unknown as Promise<Selected<T, Input> | null>
  }

  async findMany<Input extends FindInput<T>>(
    i: Input
  ): Promise<Array<Selected<T, Input>>> {
    return this._executor.execute(this._findMany(i)) as unknown as Promise<
      Array<Selected<T, Input>>
    >
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

  private _create(
    i: CreateInput<T>,
    db: DB<T>,
    continuation: (record: Partial<T>) => void,
    onError: (err: any) => void
  ) {
    const validatedInput = this.validate(i, InputTypes.Create)
    // Make a SQL query out of the parsed data
    const createQuery = this._builder.create(validatedInput)

    db.run(
      createQuery,
      (db) => {
        // Now read the record that was inserted
        // need to read it because some fields could be auto-generated
        // it would be enough to select on a unique ID, but we don't know which field(s) is the unique ID
        // hence, for now `findCreated` filters on all the values that are provided in `validatedInput.data`
        this._findUniqueWithoutAutoSelect(
          {
            where: validatedInput.data,
            select: validatedInput.select,
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
    i: FindUniqueInput<T>,
    db: DB<T>,
    continuation: (res: Partial<T> | null) => void,
    onError: (err: any) => void
  ) {
    // Note: `findUnique` differs from Prisma. In Prisma it requires to provide at least one unique field on which to search.
    //       We can't enforce that because we don't know what the unique fields of T are. This information would have to be generated from the Prisma schema.
    const data = this.validate(i, InputTypes.FindUnique)
    const sql = this._builder.findUnique(data)
    db.query(
      sql,
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
        (_, res) => {
          if (res.length == 0) return null
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
            { data: data.create, select: data.select },
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
}
