import config from '../../common/ava.config.mjs'

const files = ['test/**/*.test.ts', 'test/**/*.test.tsx']

export default {
  ...config,
  files,
}
