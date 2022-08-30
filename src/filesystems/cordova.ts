import { AnyFunction } from '../util/types'
import { File, Filesystem } from './index'

interface Cordova {
  file: {
    applicationDirectory: string
    // applicationStorageDirectory: string;
    // dataDirectory: string;
    // cacheDirectory: string;
    // externalApplicationStorageDirectory: string;
    // externalDataDirectory: string;
    // externalCacheDirectory: string;
    // externalRootDirectory: string;
    // tempDirectory: string;
    // syncedDataDirectory: string;
    // documentsDirectory: string;
    // sharedDirectory: string
  }
}

interface Entry {
  isFile: boolean
  isDirectory: boolean
  name: string
  fullPath: string
}

interface Flags {
  create?: boolean,
  exclusive?: boolean
}

interface DirectoryEntry extends Entry {
  isFile: false
  isDirectory: true

  createReader(): DirectoryReader
  getFile(path: string, options?: Flags,
    successCallback?: (entry: FileEntry) => void,
    errorCallback?: (error: FileError) => void): void
  getDirectory(path: string, options?: Flags,
    successCallback?: (entry: DirectoryEntry) => void,
    errorCallback?: (error: FileError) => void): void
}

interface DirectoryReader {
  readEntries(
    successCallback: (entries: Entry[]) => void,
    errorCallback?: (error: FileError) => void): void
}

interface FileEntry extends Entry {
  isFile: true
  isDirectory: false

  file(successCallback: (file: File) => void,
    errorCallback?: (error: FileError) => void): void
}

interface FileError {
  code: number
}

interface Window {
  resolveLocalFileSystemURL(url: string,
    successCallback: (entry: Entry) => void,
    errorCallback?: (error: FileError) => void): void
}

declare let cordova: Cordova
declare let window: Window

export class CordovaFile implements File {
  _entry: FileEntry

  name: string
  path: string

  constructor(entry: FileEntry) {
    this._entry = entry

    this.name = entry.name
    this.path = entry.fullPath
  }
}

export class CordovaFilesystem implements Filesystem {
  root: DirectoryEntry

  constructor(root: DirectoryEntry) {
    this.root = root
  }

  listDirectory(path: string): Promise<CordovaFile[]> {
    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      const error = (err: any) => reject(err)
      const success = (entries: any) => {
        const files = entries
          .filter((item: any) => item.isFile)
          .map((item: any) => new CordovaFile(item))

        resolve(files)
      }
      const readDir = (dir: DirectoryEntry): void => {
        const reader: DirectoryReader = dir.createReader()

        reader.readEntries(success, error)
      }

      this.root.getDirectory(path, {create: false, exclusive: false}, readDir, error)
    })
  }

  readFile(file: CordovaFile): Promise<string> {
    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      const error = (err?: any) => reject(err)
      const success = (f: any) => {
        const reader = new FileReader()
        reader.addEventListener('error', error)
        reader.addEventListener('load', () => resolve(reader.result))
        reader.readAsText(f)
      }

      file._entry.file(success, error)
    })
  }

  // We need an async function to resolve the filesystem.
  static async init(url: string = cordova.file.applicationDirectory): Promise<CordovaFilesystem> {
    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      const success = (root: any) => {
        resolve(new CordovaFilesystem(root))
      }
      const error = (err: any) => reject(err)

      window.resolveLocalFileSystemURL(url, success, error)
    })
  }
}
