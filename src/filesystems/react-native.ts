import RNFS from 'react-native-fs'
import { File, Filesystem } from './index'

// Subset of the RNFS type.
interface ReadDirItem {
  name: string // The name of the item
  path: string // The absolute path to the item
  isFile: () => boolean // Is the file just a file?
}

export class ReactNativeFile implements File {
  name: string
  path: string

  constructor(item: ReadDirItem) {
    this.name = item.name
    this.path = item.path
  }
}

export class ReactNativeFilesystem implements Filesystem {
  listDirectory(path: string): Promise<ReactNativeFile[]> {
    return RNFS.readDir(path)
      .then((items) => {
        return items
          .filter((item: ReadDirItem) => item.isFile())
          .map((item: ReadDirItem) => new ReactNativeFile(item))
      })
  }

  readFile(file: ReactNativeFile): Promise<string> {
    return RNFS.readFile(file.path)
  }
}
