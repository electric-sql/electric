/**
 * VitePress data files export `default { load }` and synthesize a
 * `data` export. Type the `import * as` module with `VitepressDataModule<T>`.
 */
export type VitepressDataModule<T> = { data: T }

/** Parsed YAML object from `yaml` before we narrow to a row type. */
export type YamlRecord = Record<string, unknown>

// --- posts.data (blog) ---

/** Raw YAML for a blog post before derived `path` / `date` / `excerpt` are applied. */
export type PostFrontmatter = {
  published?: boolean
  excerpt?: string
  [key: string]: unknown
}

/** Row produced by the posts data loader (frontmatter + derived fields). */
export interface PostListRow {
  published?: boolean
  path: string
  excerpt: string
  date: string
  title?: string
  image?: string
  tags?: unknown
  authors?: string[]
  [key: string]: unknown
}

/** Tighter shape for post cards in sections that expect full frontmatter. */
export interface SitePost {
  title: string
  path: string
  image: string
  excerpt: string
  tags?: string[]
  authors: string[]
  date: string
}

export type PostsDataModule = VitepressDataModule<PostListRow[]>

// --- count.data (GitHub stars) ---

export type StarCountByRepo = Record<string, number>

export type CountDataModule = VitepressDataModule<StarCountByRepo>

// --- demos.data ---

export interface DemoListRow {
  order?: string
  demo?: boolean
  homepage?: boolean
  link: string
  title?: string
  description?: string
  image?: string
  listing_image?: string
  [key: string]: unknown
}

/** Featured strip on /sync; narrows `DemoListRow` with required copy fields. */
export interface HomepageDemoCard extends DemoListRow {
  title: string
  description: string
  link: string
}

export interface DemosPayload {
  demos: DemoListRow[]
  /** Featured strip on /sync; YAML rows include title, description, link, images. */
  homepage_demos: HomepageDemoCard[]
  examples: DemoListRow[]
}

export type DemosDataModule = VitepressDataModule<DemosPayload>

// --- use-cases.data ---

export interface UseCaseListRow {
  homepage?: boolean
  homepage_order?: string
  link: string
  [key: string]: unknown
}

// --- team.data ---

export interface TeamMemberStub {
  published?: boolean
  [key: string]: unknown
}

// --- pricing (YAML) ---

export type GlobalPricingConfig = Record<string, unknown> & {
  baseRates?: { writesPerMillion: number; retentionPerGBMonth: number }
}

export interface PlanYamlRow {
  type?: string
  discountPercent?: number
  order?: number
  effectiveWriteRate?: number
  effectiveRetentionRate?: number
  [key: string]: unknown
}
