#!/usr/bin/env node

import { pathToFileURL } from 'node:url'
import { main } from './entrypoint-lib.js'

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main()
}
