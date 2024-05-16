import uniqWith from 'lodash.uniqwith'

import { Shape } from './types'
import { QualifiedTablename } from '../../util'

/** List all tables covered by a given shape */
export function getAllTablesForShape(
  shape: Shape,
  schema = 'main'
): QualifiedTablename[] {
  return uniqWith(doGetAllTablesForShape(shape, schema), (a, b) => a.isEqual(b))
}

function doGetAllTablesForShape(
  shape: Shape,
  schema: string
): QualifiedTablename[] {
  const includes =
    shape.include?.flatMap((x) => doGetAllTablesForShape(x.select, schema)) ??
    []
  includes.push(new QualifiedTablename(schema, shape.tablename))
  return includes
}
