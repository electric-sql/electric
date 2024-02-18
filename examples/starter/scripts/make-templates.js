import { join } from 'path'
import { copyTemplateOverlayFiles } from './template-utils.js'
import templateConfig from '../template-config.js'

const baseDir = new URL('.', import.meta.url).pathname
const templateOverlayDir = join(baseDir, '..', 'template-overlay')
for (const templateType in templateConfig) {
  const templateSource = join(baseDir, '..', '..', templateConfig[templateType])
  const templateTarget = join(baseDir, '..', `template-${templateType}`)
  copyTemplateOverlayFiles(templateSource, templateTarget, templateOverlayDir)
}
