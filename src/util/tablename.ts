import { DbNamespace, Tablename } from './types'

export class QualifiedTablename {
  namespace: DbNamespace
  tablename: Tablename

  constructor(namespace: DbNamespace, tablename: Tablename) {
    this.namespace = namespace
    this.tablename = tablename
  }
}
