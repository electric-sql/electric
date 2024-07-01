export const TOOLBAR_ELEMENT_ID = '__electric_debug_toolbar'
export const TOOLBAR_CONTAINER_ID = `${TOOLBAR_ELEMENT_ID}_container`
export const TOOLBAR_TEMPLATE_ID = `${TOOLBAR_ELEMENT_ID}_template`

export const getToolbarElem = (): HTMLElement =>
  getToolbarContainer().shadowRoot!.getElementById(TOOLBAR_ELEMENT_ID)!

export const getToolbarContainer = (): HTMLElement =>
  document.getElementById(TOOLBAR_CONTAINER_ID)! as HTMLElement

export const getToolbarTemplate = (): HTMLTemplateElement =>
  document.getElementById(TOOLBAR_TEMPLATE_ID) as HTMLTemplateElement
