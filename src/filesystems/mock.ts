import { AnyFunction } from '../util/types'
import { File, Filesystem } from './index'

export class MockFile implements File {
  name: string
  path: string

  constructor(name: string, path: string) {
    this.name = name
    this.path = path
  }
}

export class MockFilesystem implements Filesystem {
  listDirectory(path: string): Promise<MockFile[]> {
    return new Promise((resolve: AnyFunction) => {
      const normalisedPath = path.endsWith('/') ? path.slice(0, -1) : path
      const files = [
        new MockFile('foo.sql', `${normalisedPath}/foo.sql`),
        new MockFile('bar.sql', `${normalisedPath}/bar.sql`)
      ]

      resolve(files)
    })
  }

  readFile(file: MockFile): Promise<string> {
    return new Promise((resolve: AnyFunction) => {
      resolve(`-- ${file.name}`)
    })
  }
}
