import { CreateFileOptions, FileWriter } from '../../src/classes'

class TestFileWriter extends FileWriter {
  public createFileString(
    writerFn: (options: CreateFileOptions) => void
  ): string {
    writerFn({
      writer: this.writer,
      writeImport: this.writeImport.bind(this),
      writeImportSet: this.writeImportSet.bind(this),
      writeExport: this.writeExport.bind(this),
      writeImports: this.writeImports.bind(this),
      writeHeading: this.writeHeading.bind(this),
      writeJSDoc: this.writeJSDoc.bind(this),
    })

    return this.writer.toString()
  }
}

export { TestFileWriter }
