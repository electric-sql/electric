export interface SkillMeta {
  name: string
  description: string
  whenToUse: string
  keywords: Array<string>
  arguments?: Array<string>
  argumentHint?: string
  userInvocable?: boolean
  max: number
  charCount: number
  contentHash: string
  source: string
}

export interface SkillsRegistry {
  /** All skill metadata, keyed by name. */
  catalog: ReadonlyMap<string, SkillMeta>
  /** Render the skill catalog as text for context injection. Fits within budget (chars). */
  renderCatalog: (budget?: number) => string
  /** Read skill content from disk. Returns null if skill not found. */
  readContent: (name: string) => Promise<string | null>
}
