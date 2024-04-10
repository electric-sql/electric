import * as fs from 'fs/promises'

/*
 * Replaces the first occurence of `find` by `replace` in the file `file`.
 * If `find` is a regular expression that sets the `g` flag, then it replaces all occurences.
 */
export async function findAndReplaceInFile(
  find: string | RegExp,
  replace: string,
  file: string
) {
  const content = await fs.readFile(file, 'utf8')
  const replacedContent = content.replace(find, replace)
  await fs.writeFile(file, replacedContent)
}



export interface PackageJsonOptions {
  projectName: string
}


/**
 * Replaces the package.json file with the given project name
 * @param packageJsonFile path to package.json file
 */
export async function replacePackageJson(packageJsonFile: string, options: PackageJsonOptions) {
  // read package.json file and parse it as JSON
  // we could import it but then we get a warning
  // that importing JSON is an experimental feature
  // we can hide that warning using the --no-warnings flag
  // with nodeJS but the parsing of that flag
  // leads to problems on certain env implementations
  const projectPackageJson = JSON.parse(
    await fs.readFile(packageJsonFile, 'utf8')
  )

  // Update the project's package.json with the new project name
  projectPackageJson.name = options.projectName

  await fs.writeFile(packageJsonFile, JSON.stringify(projectPackageJson, null, 2))
}