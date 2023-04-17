declare module 'wa-sqlite/dist/wa-sqlite-async.mjs' {
  function ModuleFactory(config?: object): Promise<any>
  export = ModuleFactory
}

declare interface VFSOptions {
  durability: 'default' | 'strict' | 'relaxed'
  purge: 'deferred' | 'manual'
  purgeAtLeast: number
}

declare module 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js' {
  // Declare that the IDBBatchAtomicVFS class implements SQLiteVFS
  // without having to re-declare the entire SQLiteVFS interface here.
  // Can be done by merging the class declaration with the interface declaration
  // as explained in this post:
  // https://stackoverflow.com/questions/52930536/typescript-declare-class-implementing-interface

  /* eslint-disable @typescript-eslint/no-empty-interface */
  interface IDBBatchAtomicVFS extends SQLiteVFS {}
  export class IDBBatchAtomicVFS {
    constructor(idbDatabaseName: string, options?: VFSOptions)
  }
}
