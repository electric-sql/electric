// Available templates for the starter
enum TemplateType {
  react = 'react',
  vue = 'vue',
}
const validTemplates = Object.values(TemplateType) as readonly string[]

function getTemplateDirectory(templateType: TemplateType): string {
  return `template-${templateType}`
}

export { TemplateType, validTemplates, getTemplateDirectory }
