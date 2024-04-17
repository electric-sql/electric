import test from 'ava'
import * as path from 'path'
import * as fs from 'fs/promises'
import {
  assertDirectoryExists,
  assertFileContains,
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
const envFilePath = path.join(testAppDir, '.env.local')

async function assertPackageJson(t) {
  const packageJsonPath = path.join(testAppDir, 'package.json')

  await t.notThrowsAsync(() => assertFileExists(packageJsonPath))
  const packageJson = await readJsonFile(packageJsonPath)

  t.is(packageJson.name, testAppName)
}

async function assertEnvFile(
  t,
  electricPort = 5133,
  electricProxyPort = 65432,
) {
  await t.notThrowsAsync(() => assertFileExists(envFilePath))
  await t.notThrowsAsync(() =>
    assertFileContains(
      envFilePath,
      new RegExp(`ELECTRIC_SERVICE=http:\/\/localhost:${electricPort}`),
    ),
  )
  await t.notThrowsAsync(() =>
    assertFileContains(
      envFilePath,
      new RegExp(`ELECTRIC_PG_PROXY_PORT=${electricProxyPort}`),
    ),
  )
}

test.serial.before(async (t) => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

test.serial.beforeEach(async (t) => {
  t.timeout(10 * 60000)
  await fs.mkdir(tempDir, { recursive: true })
})

test.serial.afterEach.always(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

test.serial('should create React project', async (t) => {
  await t.notThrowsAsync(() =>
    runCommand(`npx create-electric-app ${testAppName}`, tempDir),
  )

  await assertPackageJson(t)
  await assertEnvFile(t)
})

test.serial('should create Vue.js project', async (t) => {
  await t.notThrowsAsync(() =>
    runCommand(
      `npx create-electric-app ${testAppName} --template vue`,
      tempDir,
    ),
  )

  await assertPackageJson(t)
  await assertEnvFile(t)
})

test.serial('should create Expo project', async (t) => {
  await t.notThrowsAsync(() =>
    runCommand(
      `npx create-electric-app ${testAppName} --template expo`,
      tempDir,
    ),
  )

  await assertPackageJson(t)
  await assertEnvFile(t)

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
  await assertEnvFile(t)

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

test.serial('should set environment variables for project', async (t) => {
  const electricPort = 1234
  const electricProxyPort = 12345
  await t.notThrowsAsync(() =>
    runCommand(
      `npx create-electric-app ${testAppName} --electric-port ${electricPort} --electric-proxy-port ${electricProxyPort}`,
      tempDir,
    ),
  )
  await assertEnvFile(t, electricPort, electricProxyPort)
})
