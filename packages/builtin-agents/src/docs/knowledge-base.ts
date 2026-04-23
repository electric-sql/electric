import { createHash } from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { Type } from '@sinclair/typebox'
import { load as loadSqliteVec } from 'sqlite-vec'
import { EMBEDDING_DIMENSIONS, embedText, embeddingToSqlInput } from './embed'
import type { AgentTool, WakeEvent } from '@electric-ax/agent-runtime'
import type { ChangeEvent } from '@durable-streams/state'

export interface SearchResult {
  id: number
  docPath: string
  title: string
  heading: string
  content: string
  hybridScore: number
  bm25Rank: number | null
  vectorRank: number | null
}

export interface HortonDocsSupport {
  createSearchTool: () => AgentTool
  resolveCurrentQuestion: (
    wake: WakeEvent,
    events: Array<Pick<ChangeEvent, `type` | `value`>>,
    inbox: Array<{ payload?: unknown }>
  ) => string
  renderRetrievedDocsSource: (
    wake: WakeEvent,
    events: Array<Pick<ChangeEvent, `type` | `value`>>,
    inbox: Array<{ payload?: unknown }>
  ) => Promise<string>
  renderCompressedToc: () => Promise<string>
  ensureReady: () => Promise<void>
}

interface ChunkRow {
  id: number
  docPath: string
  title: string
  heading: string
  chunkIndex: number
  content: string
}

interface InMemoryChunk extends ChunkRow {
  embedding: Float32Array
}

interface InMemoryDoc {
  path: string
  title: string
  content: string
}

interface DocOutlineEntry {
  path: string
  title: string
  headings: Array<string>
}

interface DocsIndexStats {
  docCount: number
  chunkCount: number
  fingerprint: string
}

interface DocsKnowledgeBaseOptions {
  docsRoot: string
  dbPath: string
  logPrefix?: string
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const INDEX_VERSION = `1`
const DOCS_FINGERPRINT_KEY = `docs_fingerprint`
const INDEX_VERSION_KEY = `index_version`
const DEFAULT_K = 8

function parseFrontmatter(value: string): { title?: string; body: string } {
  if (!value.startsWith(`---\n`)) {
    return { body: value }
  }

  const end = value.indexOf(`\n---\n`, 4)
  if (end === -1) {
    return { body: value }
  }

  const frontmatter = value.slice(4, end)
  const titleMatch = frontmatter.match(/^title:\s*(.+)$/m)
  return {
    title: titleMatch?.[1]?.trim().replace(/^['"]|['"]$/g, ``),
    body: value.slice(end + 5),
  }
}

function firstHeading(value: string): string | undefined {
  const match = value.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim()
}

function collectHeadings(value: string): Array<string> {
  const headings: Array<string> = []
  for (const line of value.split(`\n`)) {
    const match = line.match(/^#{1,6}\s+(.+)$/)
    if (match) {
      headings.push(match[1]!.trim())
    }
  }
  return headings
}

function toDocTitle(relativePath: string, content: string): string {
  const parsed = parseFrontmatter(content)
  return (
    parsed.title ??
    firstHeading(parsed.body) ??
    relativePath.replace(/\.md$/, ``).split(`/`).at(-1) ??
    relativePath
  )
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, `\n`)
    .replace(/\n{3,}/g, `\n\n`)
    .trim()
}

async function collectMarkdownFiles(root: string): Promise<Array<string>> {
  async function walk(dir: string): Promise<Array<string>> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const files: Array<string> = []
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...(await walk(fullPath)))
        continue
      }
      if (entry.isFile() && entry.name.endsWith(`.md`)) {
        files.push(fullPath)
      }
    }
    return files
  }

  return walk(root)
}

function chunkMarkdown(input: {
  relativePath: string
  content: string
}): Array<Omit<ChunkRow, `id`>> {
  const parsed = parseFrontmatter(input.content)
  const title = toDocTitle(input.relativePath, input.content)
  const lines = parsed.body.split(`\n`)
  const sections: Array<{ heading: string; text: string }> = []
  let currentHeading = title
  let currentLines: Array<string> = []

  function pushSection(): void {
    const text = normalizeWhitespace(currentLines.join(`\n`))
    if (!text) {
      return
    }
    sections.push({ heading: currentHeading, text })
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      pushSection()
      currentHeading = headingMatch[2]!.trim()
      currentLines = [line]
      continue
    }
    currentLines.push(line)
  }
  pushSection()

  const chunks: Array<Omit<ChunkRow, `id`>> = []
  let chunkIndex = 0

  for (const section of sections) {
    const paragraphs = section.text
      .split(/\n\s*\n/)
      .map((paragraph) => normalizeWhitespace(paragraph))
      .filter(Boolean)

    let current = ``
    for (const paragraph of paragraphs) {
      const candidate = current ? `${current}\n\n${paragraph}` : paragraph
      if (candidate.length <= 1200) {
        current = candidate
        continue
      }

      if (current) {
        chunks.push({
          docPath: input.relativePath,
          title,
          heading: section.heading,
          chunkIndex: chunkIndex++,
          content: current,
        })
      }

      if (paragraph.length <= 1200) {
        current = paragraph
        continue
      }

      const overlap = 150
      let start = 0
      while (start < paragraph.length) {
        const end = Math.min(start + 1200, paragraph.length)
        const slice = paragraph.slice(start, end).trim()
        if (slice) {
          chunks.push({
            docPath: input.relativePath,
            title,
            heading: section.heading,
            chunkIndex: chunkIndex++,
            content: slice,
          })
        }
        if (end >= paragraph.length) {
          current = ``
          break
        }
        start = Math.max(end - overlap, start + 1)
      }
    }

    if (current) {
      chunks.push({
        docPath: input.relativePath,
        title,
        heading: section.heading,
        chunkIndex: chunkIndex++,
        content: current,
      })
    }
  }

  return chunks
}

function createFingerprint(
  entries: Array<{ path: string; content: string }>
): string {
  const hash = createHash(`sha256`)
  for (const entry of entries) {
    hash.update(entry.path)
    hash.update(`\0`)
    hash.update(entry.content)
    hash.update(`\0`)
  }
  return hash.digest(`hex`)
}

function getMeta(db: Database.Database, key: string): string | null {
  const row = db
    .prepare(`select value from index_meta where key = ?`)
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

function setMeta(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `insert into index_meta(key, value) values(?, ?)
     on conflict(key) do update set value = excluded.value`
  ).run(key, value)
}

function reciprocalRank(rank: number | null, k = 60): number {
  return rank === null ? 0 : 1 / (k + rank)
}

function sanitizeSnippet(value: string): string {
  return value.replace(/\s+/g, ` `).trim()
}

function vectorQuerySql(): string {
  return `
    select
      id,
      doc_path as docPath,
      title,
      heading,
      content
    from chunks
    order by vec_distance_cosine(embedding, vec_f32(?)) asc
    limit ?
  `
}

function payloadToText(payload: unknown): string {
  if (typeof payload === `string`) {
    return payload
  }
  if (payload && typeof payload === `object`) {
    const text = (payload as { text?: unknown }).text
    if (typeof text === `string`) {
      return text
    }
    return JSON.stringify(payload)
  }
  return String(payload ?? ``)
}

function findLatestQuestion(
  items: Array<{ payload?: unknown } | undefined>
): string | undefined {
  for (let index = items.length - 1; index >= 0; index--) {
    const text = payloadToText(items[index]?.payload).trim()
    if (text.length > 0) {
      return text
    }
  }

  return undefined
}

export function resolveDocsRoot(workingDirectory: string): string | null {
  const candidates = [
    process.env.HORTON_DOCS_ROOT,
    path.resolve(workingDirectory, `electric-agents-docs/docs`),
    path.resolve(process.cwd(), `electric-agents-docs/docs`),
    path.resolve(MODULE_DIR, `../../../../../electric-agents-docs/docs`),
  ].filter((value): value is string => typeof value === `string`)

  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

class DocsKnowledgeBase {
  readonly db: Database.Database | null
  readonly docsRoot: string
  readonly dbPath: string
  readonly logPrefix: string
  private fallbackDocs: Array<InMemoryDoc> = []
  private fallbackChunks: Array<InMemoryChunk> = []
  private fallbackFingerprint = ``
  private readonly readyPromise: Promise<DocsIndexStats>

  constructor(options: DocsKnowledgeBaseOptions) {
    this.docsRoot = options.docsRoot
    this.dbPath = options.dbPath
    this.logPrefix = options.logPrefix ?? `[horton-docs]`
    this.db = this.openDatabase()
    this.createSchema()
    this.readyPromise = this.ensureIngested()
  }

  private openDatabase(): Database.Database | null {
    fsSync.mkdirSync(path.dirname(this.dbPath), { recursive: true })
    try {
      const db = new Database(this.dbPath)
      loadSqliteVec(db)
      db.pragma(`journal_mode = WAL`)
      db.pragma(`synchronous = NORMAL`)
      return db
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `${this.logPrefix} falling back to in-memory docs index: ${message}`
      )
      return null
    }
  }

  private createSchema(): void {
    if (!this.db) {
      return
    }
    this.db.exec(`
      create table if not exists index_meta (
        key text primary key,
        value text not null
      );

      create table if not exists docs (
        path text primary key,
        title text not null,
        content text not null
      );

      create table if not exists chunks (
        id integer primary key,
        doc_path text not null,
        title text not null,
        heading text not null,
        chunk_index integer not null,
        content text not null,
        embedding blob not null check(vec_length(embedding) = ${EMBEDDING_DIMENSIONS}),
        foreign key (doc_path) references docs(path) on delete cascade
      );

      create index if not exists chunks_doc_path_idx on chunks(doc_path);

      create virtual table if not exists chunks_fts using fts5(
        doc_path,
        title,
        heading,
        content,
        tokenize = 'porter unicode61'
      );
    `)
  }

  async ensureReady(): Promise<void> {
    await this.readyPromise
  }

  private stats(): DocsIndexStats {
    if (!this.db) {
      return {
        docCount: this.fallbackDocs.length,
        chunkCount: this.fallbackChunks.length,
        fingerprint: this.fallbackFingerprint,
      }
    }

    const docCount = Number(
      (
        this.db.prepare(`select count(*) as count from docs`).get() as {
          count: number
        }
      ).count
    )
    const chunkCount = Number(
      (
        this.db.prepare(`select count(*) as count from chunks`).get() as {
          count: number
        }
      ).count
    )

    return {
      docCount,
      chunkCount,
      fingerprint: getMeta(this.db, DOCS_FINGERPRINT_KEY) ?? ``,
    }
  }

  private async ensureIngested(): Promise<DocsIndexStats> {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true })
    const files = (await collectMarkdownFiles(this.docsRoot)).sort()
    const docs = await Promise.all(
      files.map(async (filePath) => ({
        path: path.relative(this.docsRoot, filePath),
        content: await fs.readFile(filePath, `utf8`),
      }))
    )
    const fingerprint = createFingerprint(docs)
    if (!this.db) {
      if (
        this.fallbackFingerprint === fingerprint &&
        this.fallbackChunks.length > 0
      ) {
        return this.stats()
      }

      this.fallbackDocs = docs.map((doc) => ({
        path: doc.path,
        title: toDocTitle(doc.path, doc.content),
        content: doc.content,
      }))
      this.fallbackChunks = []

      let nextId = 1
      for (const doc of docs) {
        for (const chunk of chunkMarkdown({
          relativePath: doc.path,
          content: doc.content,
        })) {
          const searchableText = `${chunk.title}\n${chunk.heading}\n${chunk.content}`
          this.fallbackChunks.push({
            ...chunk,
            id: nextId++,
            embedding: embedText(searchableText),
          })
        }
      }

      this.fallbackFingerprint = fingerprint
      const stats = this.stats()
      console.log(
        `${this.logPrefix} indexed ${stats.docCount} docs into ${stats.chunkCount} chunks (${stats.fingerprint.slice(0, 12)}...)`
      )
      return stats
    }

    const db = this.db
    const currentFingerprint = getMeta(db, DOCS_FINGERPRINT_KEY)
    const currentVersion = getMeta(db, INDEX_VERSION_KEY)

    if (
      currentFingerprint === fingerprint &&
      currentVersion === INDEX_VERSION &&
      this.stats().chunkCount > 0
    ) {
      return this.stats()
    }

    const insertDoc = db.prepare(
      `insert into docs(path, title, content) values(?, ?, ?)`
    )
    const insertChunk = db.prepare(
      `insert into chunks(doc_path, title, heading, chunk_index, content, embedding)
       values(?, ?, ?, ?, ?, vec_f32(?))`
    )
    const insertFts = db.prepare(
      `insert into chunks_fts(rowid, doc_path, title, heading, content)
       values(?, ?, ?, ?, ?)`
    )
    const reset = db.transaction(() => {
      db.exec(`
        delete from chunks_fts;
        delete from chunks;
        delete from docs;
      `)

      for (const doc of docs) {
        const title = toDocTitle(doc.path, doc.content)
        insertDoc.run(doc.path, title, doc.content)
        const chunks = chunkMarkdown({
          relativePath: doc.path,
          content: doc.content,
        })

        for (const chunk of chunks) {
          const searchableText = `${chunk.title}\n${chunk.heading}\n${chunk.content}`
          const embedding = embeddingToSqlInput(embedText(searchableText))
          const result = insertChunk.run(
            chunk.docPath,
            chunk.title,
            chunk.heading,
            chunk.chunkIndex,
            chunk.content,
            embedding
          )
          insertFts.run(
            Number(result.lastInsertRowid),
            chunk.docPath,
            chunk.title,
            chunk.heading,
            chunk.content
          )
        }
      }

      setMeta(db, DOCS_FINGERPRINT_KEY, fingerprint)
      setMeta(db, INDEX_VERSION_KEY, INDEX_VERSION)
    })

    reset()
    const stats = this.stats()
    console.log(
      `${this.logPrefix} indexed ${stats.docCount} docs into ${stats.chunkCount} chunks (${stats.fingerprint.slice(0, 12)}...)`
    )
    return stats
  }

  hybridSearch(query: string, limit = DEFAULT_K): Array<SearchResult> {
    const cleanedQuery = query.trim()
    if (!cleanedQuery) {
      return []
    }

    if (!this.db) {
      const queryEmbedding = embedText(cleanedQuery)
      const vectorMatches = [...this.fallbackChunks]
        .map((chunk) => ({
          ...chunk,
          vectorScore: dotProduct(queryEmbedding, chunk.embedding),
        }))
        .sort((left, right) => right.vectorScore - left.vectorScore)
        .slice(0, limit * 3)

      const tokens = cleanedQuery
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ` `)
        .split(/\s+/)
        .filter((token) => token.length >= 2)

      const bm25Matches =
        tokens.length > 0
          ? [...this.fallbackChunks]
              .map((chunk) => ({
                ...chunk,
                bm25Score: keywordScore(
                  `${chunk.title}\n${chunk.heading}\n${chunk.content}`,
                  tokens
                ),
              }))
              .filter((chunk) => chunk.bm25Score > 0)
              .sort((left, right) => right.bm25Score - left.bm25Score)
              .slice(0, limit * 3)
          : []

      const merged = new Map<number, SearchResult>()

      for (const [index, row] of bm25Matches.entries()) {
        const existing = merged.get(row.id)
        merged.set(row.id, {
          id: row.id,
          docPath: row.docPath,
          title: row.title,
          heading: row.heading,
          content: row.content,
          hybridScore:
            reciprocalRank(index + 1) +
            reciprocalRank(existing?.vectorRank ?? null),
          bm25Rank: index + 1,
          vectorRank: existing?.vectorRank ?? null,
        })
      }

      for (const [index, row] of vectorMatches.entries()) {
        const existing = merged.get(row.id)
        merged.set(row.id, {
          id: row.id,
          docPath: row.docPath,
          title: row.title,
          heading: row.heading,
          content: row.content,
          hybridScore:
            reciprocalRank(existing?.bm25Rank ?? null) +
            reciprocalRank(index + 1),
          bm25Rank: existing?.bm25Rank ?? null,
          vectorRank: index + 1,
        })
      }

      return [...merged.values()]
        .sort((left, right) => right.hybridScore - left.hybridScore)
        .slice(0, limit)
    }

    const vectorMatches = this.db
      .prepare(vectorQuerySql())
      .all(embeddingToSqlInput(embedText(cleanedQuery)), limit * 3) as Array<{
      id: number
      docPath: string
      title: string
      heading: string
      content: string
    }>

    const tokens = cleanedQuery
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ` `)
      .split(/\s+/)
      .filter((token) => token.length >= 2)
    const ftsQuery =
      tokens.length > 0
        ? tokens.map((token) => `"${token}"`).join(` OR `)
        : null

    const bm25Matches = ftsQuery
      ? (this.db
          .prepare(
            `
            select
              c.id as id,
              c.doc_path as docPath,
              c.title as title,
              c.heading as heading,
              c.content as content,
              bm25(chunks_fts) as bm25Score
            from chunks_fts
            join chunks c on c.id = chunks_fts.rowid
            where chunks_fts match ?
            order by bm25Score
            limit ?
          `
          )
          .all(ftsQuery, limit * 3) as Array<{
          id: number
          docPath: string
          title: string
          heading: string
          content: string
          bm25Score: number
        }>)
      : []

    const merged = new Map<number, SearchResult>()

    for (const [index, row] of bm25Matches.entries()) {
      const existing = merged.get(row.id)
      merged.set(row.id, {
        id: row.id,
        docPath: row.docPath,
        title: row.title,
        heading: row.heading,
        content: row.content,
        hybridScore:
          reciprocalRank(index + 1) +
          reciprocalRank(existing?.vectorRank ?? null),
        bm25Rank: index + 1,
        vectorRank: existing?.vectorRank ?? null,
      })
    }

    for (const [index, row] of vectorMatches.entries()) {
      const existing = merged.get(row.id)
      merged.set(row.id, {
        id: row.id,
        docPath: row.docPath,
        title: row.title,
        heading: row.heading,
        content: row.content,
        hybridScore:
          reciprocalRank(existing?.bm25Rank ?? null) +
          reciprocalRank(index + 1),
        bm25Rank: existing?.bm25Rank ?? null,
        vectorRank: index + 1,
      })
    }

    return [...merged.values()]
      .sort((left, right) => right.hybridScore - left.hybridScore)
      .slice(0, limit)
  }

  outline(): Array<DocOutlineEntry> {
    if (!this.db) {
      return this.fallbackDocs
        .map((doc) => ({
          path: doc.path,
          title: doc.title,
          headings: collectHeadings(parseFrontmatter(doc.content).body),
        }))
        .sort((left, right) => left.path.localeCompare(right.path))
    }

    const docs = this.db
      .prepare(`select path, title, content from docs order by path`)
      .all() as Array<{ path: string; title: string; content: string }>

    return docs.map((doc) => ({
      path: doc.path,
      title: doc.title,
      headings: collectHeadings(parseFrontmatter(doc.content).body),
    }))
  }

  renderCompressedToc(maxHeadingsPerDoc = 4): string {
    const lines = [`<docs_toc>`]

    for (const doc of this.outline()) {
      const headings = doc.headings
        .slice(0, maxHeadingsPerDoc)
        .map((heading) => heading.replace(/"/g, `&quot;`))
      const attrs = [
        `path="${path.resolve(this.docsRoot, doc.path).replace(/"/g, `&quot;`)}"`,
        `title="${doc.title.replace(/"/g, `&quot;`)}"`,
      ]
      if (headings.length > 0) {
        attrs.push(`headings="${headings.join(` | `)}"`)
      }
      if (doc.headings.length > maxHeadingsPerDoc) {
        attrs.push(`more_headings="${doc.headings.length - maxHeadingsPerDoc}"`)
      }
      lines.push(`<doc ${attrs.join(` `)} />`)
    }

    lines.push(`</docs_toc>`)
    return lines.join(`\n`)
  }
}

function dotProduct(left: Float32Array, right: Float32Array): number {
  let sum = 0
  for (let index = 0; index < left.length; index++) {
    sum += (left[index] ?? 0) * (right[index] ?? 0)
  }
  return sum
}

function keywordScore(haystack: string, tokens: Array<string>): number {
  const normalized = haystack.toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (normalized.includes(token)) {
      score += 1
    }
  }
  return score
}

export function renderSearchResults(
  query: string,
  results: Array<SearchResult>,
  docsRoot?: string
): string {
  if (results.length === 0) {
    return `<docs_search query="${query.replace(/"/g, `&quot;`)}"><no_results /></docs_search>`
  }

  const lines = [`<docs_search query="${query.replace(/"/g, `&quot;`)}">`]

  for (const [index, result] of results.entries()) {
    const renderedPath = docsRoot
      ? path.resolve(docsRoot, result.docPath)
      : result.docPath
    lines.push(
      `<chunk rank="${index + 1}" path="${renderedPath.replace(/"/g, `&quot;`)}" title="${result.title.replace(/"/g, `&quot;`)}" heading="${result.heading.replace(/"/g, `&quot;`)}" chunk_id="${result.id}" hybrid_score="${result.hybridScore.toFixed(5)}" bm25_rank="${result.bm25Rank ?? ``}" vector_rank="${result.vectorRank ?? ``}">`,
      sanitizeSnippet(result.content),
      `</chunk>`
    )
  }

  lines.push(`</docs_search>`)
  return lines.join(`\n`)
}

function logSearchResults(
  kind: `initial` | `tool`,
  query: string,
  output: string
) {
  console.log(`[horton-docs] ${kind} search for "${query}"\n${output}\n`)
}

export function createHortonDocsSupport(
  workingDirectory: string,
  opts: { docsRoot?: string; dbPath?: string } = {}
): HortonDocsSupport | null {
  const docsRoot = opts.docsRoot ?? resolveDocsRoot(workingDirectory)
  if (!docsRoot) {
    return null
  }

  const dbPath =
    opts.dbPath ??
    path.resolve(workingDirectory, `.electric-agents/horton-docs.sqlite`)
  const kb = new DocsKnowledgeBase({
    docsRoot,
    dbPath,
    logPrefix: `[horton-docs]`,
  })

  function resolveCurrentQuestion(
    wake: WakeEvent,
    events: Array<Pick<ChangeEvent, `type` | `value`>>,
    inbox: Array<{ payload?: unknown }>
  ): string {
    if (wake.type === `message_received`) {
      const eventQuestion = findLatestQuestion(
        events
          .filter((event) => event.type === `message_received`)
          .map((event) => event.value as { payload?: unknown } | undefined)
      )
      if (eventQuestion) {
        return eventQuestion
      }
    }

    const wakeQuestion = payloadToText(wake.payload).trim()
    if (wakeQuestion.length > 0) {
      return wakeQuestion
    }

    return findLatestQuestion(inbox) ?? ``
  }

  return {
    async ensureReady(): Promise<void> {
      await kb.ensureReady()
    },
    resolveCurrentQuestion,
    async renderRetrievedDocsSource(wake, events, inbox): Promise<string> {
      await kb.ensureReady()
      const question = resolveCurrentQuestion(wake, events, inbox)
      if (!question) {
        return `<docs_search><no_query /></docs_search>`
      }
      const rendered = renderSearchResults(
        question,
        kb.hybridSearch(question, 6),
        kb.docsRoot
      )
      logSearchResults(`initial`, question, rendered)
      return rendered
    },
    async renderCompressedToc(): Promise<string> {
      await kb.ensureReady()
      return kb.renderCompressedToc()
    },
    createSearchTool(): AgentTool {
      return {
        name: `search_durable_agents_docs`,
        label: `Search Durable Agents Docs`,
        description: `Run a hybrid BM25 plus vector search over the local Durable Agents documentation index.`,
        parameters: Type.Object({
          query: Type.String({
            description: `The docs question or search query to run.`,
          }),
          limit: Type.Optional(
            Type.Number({
              minimum: 1,
              maximum: 12,
              description: `Maximum number of chunks to return.`,
            })
          ),
        }),
        execute: async (_toolCallId, params) => {
          await kb.ensureReady()
          const query = String(
            (params as { query?: unknown }).query ?? ``
          ).trim()
          const limit = Number((params as { limit?: unknown }).limit ?? 6)
          const results = kb.hybridSearch(
            query,
            Math.min(Math.max(limit, 1), 12)
          )
          const rendered = renderSearchResults(query, results, kb.docsRoot)
          logSearchResults(`tool`, query, rendered)
          return {
            content: [{ type: `text` as const, text: rendered }],
            details: {
              query,
              resultCount: results.length,
              results: results.map((result) => ({
                id: result.id,
                docPath: result.docPath,
                heading: result.heading,
                hybridScore: result.hybridScore,
              })),
            },
          }
        },
      }
    },
  }
}
