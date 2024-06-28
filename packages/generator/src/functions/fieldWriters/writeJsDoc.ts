import CodeBlockWriter from 'code-block-writer'

export const writeJsDoc = (writer: CodeBlockWriter, jsDoc?: string) => {
  if (!jsDoc) return

  writer.writeLine(`/**`)
  jsDoc.split(/\n\r?/).forEach((line) => {
    writer.writeLine(` * ${line.trim()}`)
  })
  writer.writeLine(` */`)
}
