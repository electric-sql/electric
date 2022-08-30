// Read files using the node.js 'fs/promises' API.
// This module *must* only be imported when running on
// the node platform, with the `fs` module available.

import fs from 'fs'
import fsPromises from 'fs/promises'
import pathModule from 'path'

import { File, Filesystem } from './index'

interface ReadDirOpts {
  encoding: 'utf8',
  withFileTypes: true
}

interface ReadFileOpts {
  encoding: 'utf8',
  flag: 'r'
}

export class NodeFile implements File {
  name: string
  path: string

  constructor(name: string, basePath: string) {
    this.name = name
    this.path = pathModule.join(basePath, name)
  }
}

export class NodeFilesystem implements Filesystem {
  readDirOpts: ReadDirOpts
  readFileOpts: ReadFileOpts

  constructor() {
    this.readDirOpts = {
      encoding: 'utf8',
      withFileTypes: true
    }
    this.readFileOpts = {
      encoding: 'utf8',
      flag: 'r'
    }
  }

  listDirectory(path: string): Promise<NodeFile[]> {
    return fsPromises.readdir(path, this.readDirOpts)
      .then((files) => {
        return files
          .filter((x: fs.Dirent) => x.isFile())
          .map((x: fs.Dirent) => new NodeFile(x.name, path))
      })
  }

  readFile(file: NodeFile): Promise<string> {
    return fsPromises.readFile(file.path, this.readFileOpts)
  }
}
