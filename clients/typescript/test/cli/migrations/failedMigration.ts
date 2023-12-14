// script meant to fail the generation of a client
import { defaultOptions, generate } from '../../../src/cli/migrations/migrate'
generate({ ...defaultOptions, service: 'non-existent' })
