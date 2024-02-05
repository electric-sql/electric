import { TestFn } from 'ava'
import Log from 'loglevel'

export type LoggedMsg = string

// Mock the logged messages storing them into `log`
// based on "Writing plugins" in https://github.com/pimterry/loglevel
export function setupLoggerMock<T>(
  test: TestFn<T>,
  getLog: () => Array<LoggedMsg>
) {
  const originalFactory = Log.methodFactory
  Log.methodFactory = function (methodName, logLevel, loggerName) {
    const rawMethod = originalFactory(methodName, logLevel, loggerName)

    return function (message) {
      getLog().push(message)

      // eslint-disable-next-line no-constant-condition
      if (false) {
        // We can call the logger for debug purposes
        rawMethod(message)
      }
    }
  }
  Log.setLevel(Log.levels.DEBUG) // Be sure to call setLevel method in order to apply plugin

  test.beforeEach(() => {
    // Clear the log before each test
    getLog().length = 0
  })
}
