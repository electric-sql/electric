import path from 'path'

/**
 * Path where the user ran `npx electric`
 */
export const appRoot = path.resolve()

/**
 * Path to the package.json of the user app
 */
export const appPackageJsonPath = path.join(appRoot, 'package.json')
