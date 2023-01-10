export const overrideDefined = (
  defaults: object = {},
  overrides: object = {}
): object => {
  const filteredOverrides: { [key: string | symbol]: any } = {}

  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) {
      filteredOverrides[k] = v
    }
  }

  return Object.assign({}, defaults, filteredOverrides)
}
