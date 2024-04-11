import test from 'ava'
import * as path from 'path'
import * as fs from 'fs/promises'
import {
  assertDirectoryExists,
  assertFileExists,
  readJsonFile,
  runCommand,
} from './test-utils.js'

// directory to create projects in
const tempDir = path.join(new URL('.', import.meta.url).pathname, '..', '.tmp')

const testAppName = 'test-app'
const testAppSlug = 'test-app'
const testAppAndroidProjectName = 'TestApp'
const testAppDisplayName = 'Test App'
const testAppDir = path.join(tempDir, testAppName)

async function assertPackageJson(t) {
  const packageJsonPath = path.join(testAppDir, 'package.json')

  await t.notThrowsAsync(() => assertFileExists(packageJsonPath))
  const packageJson = await readJsonFile(packageJsonPath)

  t.is(packageJson.name, testAppName)
}

test.serial.before(async (t) => {
  t.timeout(60000)
  await fs.rm(tempDir, { recursive: true, force: true })
})

test.serial.beforeEach(async () => {
  await fs.mkdir(tempDir, { recursive: true })
})

test.serial.afterEach.always(async () => {
  // await new Promise((res) => setTimeout(res, 5000))
  await fs.rm(tempDir, { recursive: true, force: true })
})

test.serial('should create React project', async (t) => {
  await t.notThrowsAsync(() =>
    runCommand(`npx create-electric-app ${testAppName}`, tempDir),
  )

  await assertPackageJson(t)
})

test.serial('should create Vue.js project', async (t) => {
  await t.notThrowsAsync(() =>
    runCommand(
      `npx create-electric-app ${testAppName} --template vue`,
      tempDir,
    ),
  )

  await assertPackageJson(t)
})

test.serial('should create Expo project', async (t) => {
  await t.notThrowsAsync(() =>
    runCommand(
      `npx create-electric-app ${testAppName} --template expo`,
      tempDir,
    ),
  )

  await assertPackageJson(t)

  // assert project name has been modified appropriately
  const appJson = await readJsonFile(path.join(testAppDir, 'app.json'))
  t.is(appJson['expo']['name'], testAppName)
  t.is(appJson['expo']['slug'], testAppSlug)
  t.is(appJson['expo']['owner'], undefined)
})

test.serial('should create React Native project', async (t) => {
  await t.notThrowsAsync(() =>
    runCommand(
      `npx create-electric-app ${testAppName} --template react-native`,
      tempDir,
    ),
  )

  await assertPackageJson(t)

  // assert project name has been modified appropriately
  const appJson = await readJsonFile(path.join(testAppDir, 'app.json'))
  t.is(appJson['name'], testAppAndroidProjectName)
  t.is(appJson['displayName'], testAppDisplayName)

  // ensure ios and android folders have been created
  await t.notThrowsAsync(() =>
    assertDirectoryExists(path.join(testAppDir, 'ios')),
  )
  await t.notThrowsAsync(() =>
    assertDirectoryExists(path.join(testAppDir, 'android')),
  )
})
