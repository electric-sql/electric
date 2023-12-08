type TemplateParams = Record<string, string | null | undefined>;

export function templateString(template: string, params: TemplateParams): string {
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (match, key) => {
    const value = params[key.trim()];
    return value !== undefined && value !== null ? value : match;
  });
}