const validTemplates = ['react', 'vue'] as const

type TemplateType = (typeof validTemplates)[number]

function getTemplateDirectory(templateType: TemplateType): string {
  return `template-${templateType}`
}

export { validTemplates, getTemplateDirectory }
export type { TemplateType }
