import { CreateInput, CreateManyInput } from '../input/createInput'
import { SelectSubset } from '../util/types'
import { BatchPayload } from '../output/batchPayload'
import { FindInput, FindUniqueInput } from '../input/findInput'
import { UpdateInput, UpdateManyInput } from '../input/updateInput'
import { UpsertInput } from '../input/upsertInput'
import { DeleteInput, DeleteManyInput } from '../input/deleteInput'
import { QualifiedTablename } from '../../util/tablename'
import { HKT, Kind } from '../util/hkt'

/**
 * Interface that is implemented by Electric clients.
 */
export interface Model<
  CreateData extends object,
  UpdateData,
  Select,
  Where,
  WhereUnique,
  Include,
  OrderBy,
  ScalarFieldEnum,
  GetPayload extends HKT
> {
  /**
   * Creates a unique record in the DB.
   * @param i - The record to create.
   * @returns The record that was inserted in the DB.
   */
  create<T extends CreateInput<CreateData, Select, Include>>(
    i: SelectSubset<T, CreateInput<CreateData, Select, Include>>
  ): Promise<Kind<GetPayload, T>>

  /**
   * Creates several records in the DB.
   * @param i - The records to create.
   * @returns An object indicating how many records were inserted in the DB.
   */
  createMany<T extends CreateManyInput<CreateData>>(
    i: SelectSubset<T, CreateManyInput<CreateData>>
  ): Promise<BatchPayload>

  /**
   * Searches for a unique record in the DB.
   * @param i - An object containing a where field and optionally include and select fields.
   * @returns The record if found, `null` otherwise.
   *
   * @throws {@link InvalidArgumentError}
   * Thrown if the record is not unique.
   */
  findUnique<T extends FindUniqueInput<Select, WhereUnique, Include>>(
    i: SelectSubset<T, FindUniqueInput<Select, WhereUnique, Include>>
  ): Promise<Kind<GetPayload, T> | null>

  /**
   * @returns The first record that matches the query, or `null` if no matching record is found.
   */
  findFirst<
    T extends FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
  >(
    i: SelectSubset<
      T,
      FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
    >
  ): Promise<Kind<GetPayload, T> | null>

  /**
   * Fetches all records that match the query.
   * To fetch only a selection of records use
   * the `take` and `skip` arguments.
   *
   * @returns All records that match the query.
   */
  findMany<
    T extends FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
  >(
    i: SelectSubset<
      T,
      FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
    >
  ): Promise<Array<Kind<GetPayload, T>>>

  // Live queries
  // The queries' return types are slightly different
  // as their result is wrapped inside a `LiveResult`
  // object that contains additional information about the table names.

  /**
   * Same as {@link Model#findUnique} but wraps the result in a {@link LiveResult} object.
   */
  liveUnique<T extends FindUniqueInput<Select, WhereUnique, Include>>(
    i: SelectSubset<T, FindUniqueInput<Select, WhereUnique, Include>>
  ): () => Promise<LiveResult<Kind<GetPayload, T> | null>>

  /**
   * Same as {@link Model#findFirst} but wraps the result in a {@link LiveResult} object.
   */
  liveFirst<
    T extends FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
  >(
    i: SelectSubset<
      T,
      FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
    >
  ): () => Promise<LiveResult<Kind<GetPayload, T> | null>>

  /**
   * Same as {@link Model#findMany} but wraps the result in a {@link LiveResult} object.
   */
  liveMany<
    T extends FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
  >(
    i: SelectSubset<
      T,
      FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
    >
  ): () => Promise<LiveResult<Array<Kind<GetPayload, T>>>>

  /**
   * Updates a single record that is uniquely identified by the provided argument.
   *
   * @param i - An object that contains the data to update and uniquely identifies the record to update in the DB.
   * @returns The updated record.
   *
   * @throws {@link InvalidArgumentError}
   * Thrown if the record does not exist or is not unique.
   */
  update<T extends UpdateInput<UpdateData, Select, WhereUnique, Include>>(
    i: SelectSubset<T, UpdateInput<UpdateData, Select, WhereUnique, Include>>
  ): Promise<Kind<GetPayload, T>>

  /**
   * Updates all the records that match the query.
   *
   * @param i - An object identifying the records to update and containing the data to update.
   * @returns An object indicating how many records were updated.
   */
  updateMany<T extends UpdateManyInput<UpdateData, Where>>(
    i: SelectSubset<T, UpdateManyInput<UpdateData, Where>>
  ): Promise<BatchPayload>

  /**
   * Inserts a record if it does not exist,
   * otherwise it updates the existing record.
   *
   * @param i - Object containing the data to create and the data to update in case it exists.
   * @returns The record that was created or updated.
   *
   * @throws {@link InvalidArgumentError}
   * Thrown if the record is not unique.
   */
  upsert<
    T extends UpsertInput<CreateData, UpdateData, Select, WhereUnique, Include>
  >(
    i: SelectSubset<
      T,
      UpsertInput<CreateData, UpdateData, Select, WhereUnique, Include>
    >
  ): Promise<Kind<GetPayload, T>>

  /**
   * Deletes the record that is uniquely identified by the provided argument.
   *
   * @param i - Object that uniquely identifies a single record.
   * @returns The deleted record.
   *
   * @throws {@link InvalidArgumentError}
   * Thrown if the record does not exist or is not unique.
   */
  delete<T extends DeleteInput<Select, WhereUnique, Include>>(
    i: SelectSubset<T, DeleteInput<Select, WhereUnique, Include>>
  ): Promise<Kind<GetPayload, T>>

  /**
   * Deletes all records that match the provided argument.
   *
   * @param i - Object that selects zero or more records to delete.
   * @returns An object indicating how many records were deleted.
   */
  deleteMany<T extends DeleteManyInput<Where>>(
    i: SelectSubset<T, DeleteManyInput<Where>>
  ): Promise<BatchPayload>
}

/**
 * A live result wrapping the `result` as well as the concerned table names.
 * The table names are used to subscribe to changes to those tables
 * in order to re-run the live query when one of the tables change.
 */
export class LiveResult<T> {
  constructor(public result: T, public tablenames: QualifiedTablename[]) {}
}

// liveRawQuery
