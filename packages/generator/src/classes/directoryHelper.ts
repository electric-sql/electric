import fs from 'fs'

/////////////////////////////////////////
//  INTERFACE
/////////////////////////////////////////

export type CreateDirOptions = fs.MakeDirectoryOptions & {
  recursive: true
}

/////////////////////////////////////////
//  CLASS
/////////////////////////////////////////

export class DirectoryHelper {
  /**
   * Checks if a directory already exists. If not, directory is created
   * @param path string to path that should be checked/created
   * @returns "true" if created or exists - "false" if path was not created
   */
  static pathExistsElseCreate(path: string) {
    return this.pathOrDirExists(path) || Boolean(this.createDir(path))
  }

  /**
   * Creates a new directory at the defined path
   * @param path string to path that should be created
   * @returns created path as string if it was created successfully - otherwise undefined
   */
  static createDir(path: string, options?: CreateDirOptions) {
    fs.mkdirSync(path, options || { recursive: true })
    return this.pathOrDirExists(path) ? path : undefined
  }

  /**
   * Checks if a path to file or directory exists
   * @param path string to path that should be checked
   * @returns "true" if path exists - otherwise "false"
   */
  static pathOrDirExists(path: string): boolean {
    return fs.existsSync(path)
  }

  static removeDir(path?: string | null) {
    if (!path) throw new Error('No path specified')
    if (!this.pathOrDirExists(path)) return
    try {
      fs.rmdirSync(path, { recursive: true })
    } catch (err) {
      if (err instanceof Error)
        throw new Error(
          `Error while deleting old data in path ${path}: ${err.message}`
        )
    }
  }
}
