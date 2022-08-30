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
    const normalisedPath = path.endsWith('/') ? path.slice(0, -1) : path
    const files = [
      new MockFile('foo.sql', `${normalisedPath}/foo.sql`),
      new MockFile('bar.sql', `${normalisedPath}/bar.sql`)
    ]

    return Promise.resolve(files)
  }

  readFile(file: MockFile): Promise<string> {
    return Promise.resolve(`-- ${file.name}`)
  }
}
