import { readFile, writeFile } from 'fs/promises'

/*
 * Replaces the first occurence of `find` by `replace` in the file `file`.
 * If `find` is a regular expression that sets the `g` flag, then it replaces all occurences.
 */
export async function findAndReplaceInFile(
  find: string | RegExp,
  replace: string,
  file: string
) {
  const content = await readFile(file, 'utf8')
  const replacedContent = content.replace(find, replace)
  await writeFile(file, replacedContent)
}
