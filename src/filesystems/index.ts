// Standardised interface to the filesystem for the target environment.
// This allows our satellite client to list and read files without
// having to know the environment its running in.

export interface File {
  name: string
  path: string
}

export interface Filesystem {
  listDirectory(path: string): Promise<File[]>
  readFile(file: File): Promise<string>
}
