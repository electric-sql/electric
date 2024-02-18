import templateConfig from '../template-config.json'

type TemplateType = keyof typeof templateConfig

const validTemplates = Object.values(templateConfig) as readonly string[]

function getTemplateDirectory(templateType: TemplateType): string {
  return `template-${templateType}`
}

export { validTemplates, getTemplateDirectory }
export type { TemplateType }
