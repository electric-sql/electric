import CodeBlockWriter, { type Options } from 'code-block-writer'
import fs from 'fs'

import { DirectoryHelper } from './directoryHelper'

export interface FileWriterOptions {
  writerOptions?: Options
}

export interface writeConstStatementOptions {
  name: string
  type: string
}

export interface CreateFileOptions {
  writer: CodeBlockWriter
  writeImport: (importName: string, importPath: string) => void
  writeImportSet: (strings: Set<string>) => void
  writeExport: (importName: string, importPath: string) => void
  writeImports: (imports: string[]) => void
  writeHeading: (headline: string, type?: 'SLIM' | 'FAT') => void
  writeJSDoc: (documentation?: string) => void
}

export interface CreateFileComplexOptions {
  /**
   * The path to the file to be created
   */
  path: string
  /**
   * The imports to be written to the file
   */
  imports: Set<string>
  /**
   * The name of the exported const statement
   */
  name?: string
  /**
   * The type of the exported const statement
   */
  type?: string
  /**
   * The default export to be written to the file
   */
  defaultExport?: string
  /**
   * The content to be written to the file
   * @param writer The CodeBlockWriter instance
   */
  content: (writer: CodeBlockWriter) => void
}

export class FileWriter {
  readonly writer: CodeBlockWriter

  constructor(options?: FileWriterOptions) {
    this.writer = new CodeBlockWriter(
      options?.writerOptions || {
        indentNumberOfSpaces: 2,
        useSingleQuote: true,
      }
    )
  }

  public createPath(path: string) {
    if (DirectoryHelper.pathOrDirExists(path)) {
      return path
    }
    return DirectoryHelper.createDir(path)
  }

  public createFile(
    path: string,
    writerFn: (options: CreateFileOptions) => void
  ) {
    writerFn({
      writer: this.writer,
      writeImport: this.writeImport.bind(this),
      writeImportSet: this.writeImportSet.bind(this),
      writeExport: this.writeExport.bind(this),
      writeImports: this.writeImports.bind(this),
      writeHeading: this.writeHeading.bind(this),
      writeJSDoc: this.writeJSDoc.bind(this),
    })

    fs.writeFileSync(path, this.writer.toString())
  }

  writeImport(importName: string, importPath: string) {
    this.writer.writeLine(`import ${importName} from '${importPath}';`)
  }

  writeImportSet(strings: Set<string>) {
    if (strings.size > 0) {
      strings.forEach((importString) => {
        this.writer.writeLine(importString)
      })
    }
  }

  writeHeading(heading: string, type: 'SLIM' | 'FAT' = 'SLIM') {
    if (type === 'SLIM') {
      return (
        this.writer
          // .newLine()
          .writeLine(`// ${heading}`)
          .writeLine('//------------------------------------------------------')
      )
    }

    return (
      this.writer
        // .newLine()
        .writeLine('/////////////////////////////////////////')
        .writeLine(`// ${heading}`)
        .writeLine('/////////////////////////////////////////')
    )
  }

  writeJSDoc(doc?: string) {
    if (!doc) return

    this.writer.writeLine(`/**`)
    doc.split(/\n\r?/).forEach((line) => {
      this.writer.writeLine(` * ${line.trim()}`)
    })
    this.writer.writeLine(` */`)
  }

  writeExport(exportName: string, exportPath: string) {
    this.writer.writeLine(`export ${exportName} from '${exportPath}';`)
  }

  writeImports(imports: string[] = []) {
    new Set(imports).forEach((importString) => {
      this.writer.writeLine(importString)
    })
  }
}
