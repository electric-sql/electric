export interface LocateFileOpts {
  locateFile?(file: string): string
}

const PLACEHOLDER = '__ELECTRIC_SQL_FILE_PLACEHOLDER__'

// Takes the locateFile option and serialises and deserialises it
// so we can pass the "function" to and from the web worker.
export class WasmLocator {
  originalOpts: LocateFileOpts

  constructor(opts: LocateFileOpts) {
    this.originalOpts = opts
  }

  serialise(): string {
    if (this.originalOpts.locateFile === undefined) {
      return PLACEHOLDER
    }

    return this.originalOpts.locateFile(PLACEHOLDER)
  }

  static deserialise(value: string): (file: string) => string {
    const parts = value.split(PLACEHOLDER)

    return (file: string) => parts.join(file)
  }
}
