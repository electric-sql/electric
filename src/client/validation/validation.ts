import * as z from 'zod'
/*
import {
  makeCreateInputSchema,
  makeCreateManyInputSchema,
  makeDeleteInputSchema,
  makeDeleteManyInputSchema,
  makeFindInputSchema,
  makeFindUniqueInputSchema,
  makeUpdateInputSchema,
  makeUpdateManyInputSchema,
  makeUpsertInputSchema,
  ZObject,
} from './schemas'
import { Input, InputTypes } from '../input/input'
 */

export function validate<I>(i: I, schema: z.ZodTypeAny): I {
  const parsedObject = schema.parse(i)

  function deepOmit(obj: Record<string, any>) {
    Object.keys(obj).map((key) => {
      const v = obj[key]
      if (v === undefined) delete obj[key]
      else if (typeof v === 'object' && !Array.isArray(v) && v !== null)
        deepOmit(v)
    })
  }

  // Zod allows users to pass `undefined` as the value for optional fields.
  // However, `undefined` is not a valid SQL value and squel.js will not turn `undefined` into `NULL`.
  // Hence, we have to do an additional pass over the `parsedObject` to remove fields whose value is `undefined`.
  deepOmit(parsedObject) as I
  return parsedObject
}

/*
export abstract class Validation<T> {
  private _input2Schema: {
    [key in InputTypes]: (schema: ZObject<T>) => z.ZodTypeAny
  }

  // The schema must be a zod object schema that has the same fields as T but those fields map to Zod types
  constructor(protected _tableName: string, protected _schema: z.ZodType<Partial<T>>) {
    //if (!(_schema instanceof z.ZodObject))
    //throw new TypeError('Invalid schema. Must be an object schema.')

    // Object that maps the different types of user input to a function that creates a schema for that input
    // This avoids having to create a validation method for every type of input.
    // To add a new type of input:
    //   - add it to `Input<T>` and `InputTypes`
    //   - define a schema for it
    //   - map the input type to the schema in the object below
    this._input2Schema = {
      [InputTypes.Create]: makeCreateInputSchema.bind(null, this._tableName),
      [InputTypes.CreateMany]: makeCreateManyInputSchema,
      [InputTypes.Find]: makeFindInputSchema.bind(null, this._tableName),
      [InputTypes.FindUnique]: makeFindUniqueInputSchema.bind(
        null,
        this._tableName
      ),
      [InputTypes.Upsert]: makeUpsertInputSchema.bind(null, this._tableName),
      [InputTypes.Update]: makeUpdateInputSchema.bind(null, this._tableName),
      [InputTypes.UpdateMany]: makeUpdateManyInputSchema,
      [InputTypes.Delete]: makeDeleteInputSchema.bind(null, this._tableName),
      [InputTypes.DeleteMany]: makeDeleteManyInputSchema,
    }
  }

  protected validate<I extends Input<T>>(i: I, inputType: InputTypes): I {
    // Fetch the right schema builder function
    const makeInputSchema = this._input2Schema[inputType]
    // Create the schema for the input
    const inputSchema = makeInputSchema(this._schema)
    // Validate the input using the schema
    return Validation.validateInternal(i, inputSchema)
  }

  static validateInternal<I>(i: I, schema: z.ZodTypeAny): I {
    const parsedObject = schema.parse(i)

    function deepOmit(obj: Record<string, any>) {
      Object.keys(obj).map((key) => {
        const v = obj[key]
        if (v === undefined) delete obj[key]
        else if (typeof v === 'object' && !Array.isArray(v) && v !== null)
          deepOmit(v)
      })
    }

    // Zod allows users to pass `undefined` as the value for optional fields.
    // However, `undefined` is not a valid SQL value and squel.js will not turn `undefined` into `NULL`.
    // Hence, we have to do an additional pass over the `parsedObject` to remove fields whose value is `undefined`.
    deepOmit(parsedObject) as I
    return parsedObject
  }
}
*/
