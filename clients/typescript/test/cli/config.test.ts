import test from 'ava'
import { getConfigValue } from '../../src/cli/config'

test('getConfigValue can capture `ELECTRIC_` prefixed CLI opitons', async (t) => {
  const image = getConfigValue('ELECTRIC_IMAGE', { image: 'electric:test' })
  const writeToPgMode = getConfigValue('ELECTRIC_WRITE_TO_PG_MODE', {
    writeToPgMode: 'test',
  })

  t.is(image, 'electric:test')
  t.is(writeToPgMode, 'test')
})
