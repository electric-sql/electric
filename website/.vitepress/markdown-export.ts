/**
 * Markdown export system overview
 *
 * This file owns the second-stage markdown export pipeline for the VitePress
 * site. It does not replace `vitepress-plugin-llms`; it builds on top of it.
 * The current system is intentionally hybrid:
 *
 * 1. First build pass: normal site build
 *    - `website/package.json` runs `npm run build:site`, which executes
 *      `vitepress build .` with `MARKDOWN_EXPORT=0`.
 *    - VitePress writes the normal site to `.vitepress/dist`.
 *    - In `website/.vitepress/config.mts`, `vitepress-plugin-llms` runs during
 *      this build and emits its own markdown artifacts such as `llms.txt` and
 *      per-page `.md` files.
 *    - The normal HTML pages are the ones served to browsers and social bots.
 *    - `AGENTS.md` is copied into `.vitepress/dist` by the build script so it
 *      can be fetched directly by coding agents.
 *
 * 2. Second build pass: markdown export render
 *    - `website/package.json` then runs `npm run build:markdown-export`, which
 *      executes `MARKDOWN_EXPORT=1 vitepress build .`.
 *    - In `config.mts`, `MARKDOWN_EXPORT` switches VitePress `outDir` from
 *      `.vitepress/dist` to `.vitepress/dist-markdown`.
 *    - The same VitePress app and same llms plugin run again, but components
 *      can now render differently because `config.mts` injects the global
 *      compile-time flag `__MARKDOWN_EXPORT__`.
 *    - Vue components read that flag through `useMarkdownExport()` and can
 *      either:
 *      - render normal HTML,
 *      - expose a subtree for HTML->Markdown conversion via
 *        `MdExportParseHtml`, or
 *      - emit explicit markdown strings via `MdExportExplicit` and
 *        `MarkdownContent`.
 *
 * 3. Post-build export step: this file merges the markdown result
 *    - `config.mts` calls `exportMarkedPagesToMarkdown(siteConfig.outDir)` from
 *      `buildEnd()` only when `MARKDOWN_EXPORT=1`.
 *    - This file reads the rendered files in `.vitepress/dist-markdown` and
 *      writes the final chosen markdown artifacts back into `.vitepress/dist`.
 *    - The end result is that the normal site still lives in `.vitepress/dist`,
 *      but selected markdown files are refreshed there using the second-pass
 *      render where components know they are exporting.
 *
 * Current division of responsibilities
 *
 * - `vitepress-plugin-llms`
 *   - remains the source of `llms.txt`
 *   - remains the source of the initial per-page markdown output
 *   - is especially valuable for source-preserving markdown pages because it
 *     starts from the authoring pipeline rather than scraping rendered HTML
 *
 * - this file
 *   - decides whether a page should be exported at all
 *   - decides which export mode to use for that page
 *   - handles component-aware export behavior
 *   - cleans or augments the final markdown written into `.vitepress/dist`
 *
 * Export modes
 *
 * Front matter controls the mode via:
 *
 * ---
 * mdExport:
 *   mode: parse-html | source-with-explicit | off
 * ---
 *
 * Behavior:
 *
 * - `source-with-explicit` (default)
 *   - This is the default mode for pages that are not explicitly configured.
 *   - It is designed for normal docs/blog pages where the authored markdown is
 *     already good and only a few embedded Vue components need custom output.
 *   - The base markdown comes from the llms plugin output generated in the
 *     second pass.
 *   - The rendered HTML is inspected for `[data-md-export="content"]` blocks
 *     emitted by components such as `YoutubeEmbed`.
 *   - The original source markdown file is also read so we can locate where the
 *     component appeared in source and splice the explicit markdown back into
 *     roughly the same place in the plugin-generated markdown.
 *   - This preserves admonitions, authored headings, and other markdown syntax
 *     much better than re-turndowning the full rendered page.
 *
 * - `parse-html`
 *   - This is for component-heavy marketing pages where the real page content
 *     largely exists in Vue templates rather than source markdown.
 *   - We select a rendered subtree (default `[data-md-export="parse-html"]`)
 *     and convert its HTML to markdown with Turndown.
 *   - `MdExportExplicit` regions inside that subtree are first replaced with
 *     placeholder tokens, then their explicit markdown is injected back into
 *     the converted markdown afterwards.
 *   - Global and per-page ignore selectors remove decorative or obviously
 *     non-markdown content before conversion.
 *
 * - `off`
 *   - The page is skipped entirely by this exporter.
 *
 * How mode selection works today
 *
 * - Front matter is the primary source of truth.
 * - If `mdExport.mode` is missing, the page defaults to
 *   `source-with-explicit`.
 * - A page can still be skipped before any mode logic via the global ignore
 *   path list in `GLOBAL_EXPORT_IGNORE_PATHS`.
 * - There is still a small override layer in `EXPORT_OVERRIDES`, but it no
 *   longer chooses the mode. It only provides page-specific details such as:
 *   - extra ignore selectors for the `agents` landing page
 *   - special title selectors for blog posts
 * - If a page only got `source-with-explicit` by default and does not actually
 *   contain the expected rendered doc root, we skip it rather than failing the
 *   build. If the mode was explicit in front matter, missing export roots are
 *   treated as an error.
 *
 * Source path and output path conventions
 *
 * - Most pages map from `foo/bar.html` to source `foo/bar.md` and output
 *   `foo/bar.md`.
 * - Blog posts are special:
 *   - rendered route: `blog/YYYY/MM/DD/slug.html`
 *   - source file: `blog/posts/YYYY-MM-DD-slug.md`
 *   - output file: `blog/YYYY/MM/DD/slug.md`
 * - This file currently knows that blog mapping explicitly.
 *
 * Interaction with components
 *
 * - `config.mts` injects `__MARKDOWN_EXPORT__`.
 * - `useMarkdownExport()` exposes that flag to components.
 * - `MdExportParseHtml` marks a subtree that should be rendered normally during
 *   the markdown-export build and then converted from HTML to markdown.
 * - `MdExportExplicit` marks a subtree whose content should not be converted as
 *   HTML; instead only nested `MarkdownContent` blocks are collected.
 * - `MarkdownContent` is the primitive for emitting raw markdown strings from a
 *   component when `isMarkdownExport` is true.
 * - Example: `YoutubeEmbed.vue` renders an iframe for normal HTML builds but
 *   emits `Watch on YouTube: ...` during markdown export.
 *
 * Ignore behavior
 *
 * There are two ignore layers:
 *
 * - `GLOBAL_EXPORT_IGNORE_PATHS`
 *   - pages that are never exported by this system at all
 *
 * - `DEFAULT_IGNORE_SELECTORS` plus `EXPORT_OVERRIDES[*].ignoreSelectors`
 *   - DOM selectors removed before HTML->Markdown conversion in `parse-html`
 *   - used for decorative visuals, buttons, anchors, copy controls, iframes,
 *     SVGs, etc.
 *
 * Relationship to social cards, Open Graph tags, and the Netlify edge function
 *
 * This file only produces static markdown assets. Runtime content negotiation
 * is handled separately by `website/netlify/edge-functions/serve-markdown.ts`.
 *
 * The edge function currently works like this:
 *
 * - For social media bots, always serve HTML by calling `context.next()`.
 *   This is necessary because link unfurlers need HTML with `twitter:*` and
 *   `og:*` meta tags, not raw markdown.
 * - For hidden/internal paths like `/.vitepress/*`, also pass through.
 * - For blog posts, if the request is explicitly for `.md` or the request does
 *   not accept `text/html`, fetch and return the markdown asset.
 * - For other whitelisted paths, if the request does not accept `text/html`,
 *   rewrite to the corresponding markdown asset (`/foo.md` or
 *   `/foo/index.md`). The site root `/` is special-cased to `/llms.txt`.
 *
 * The HTML meta tags used by social bots come from `transformHead()` in
 * `config.mts`, which injects:
 * - `twitter:card`
 * - `twitter:site`
 * - `twitter:title`
 * - `twitter:description`
 * - `twitter:image`
 * - `og:title`
 * - `og:description`
 * - `og:image`
 *
 * Those tags are generated from page front matter and the deployment origin, so
 * social bots must keep receiving HTML. That is why the edge function checks
 * `isSocialMediaBot()` before attempting any markdown response.
 *
 * Important maintenance notes
 *
 * - If you add a new component that should emit markdown, prefer explicit
 *   export via `MarkdownContent` before reaching for full HTML scraping.
 * - If you add a new component-heavy landing page, set
 *   `mdExport.mode: parse-html` in front matter and wrap the relevant content
 *   with `MdExportParseHtml`.
 * - If you add a new class of pages that should never export, add them to
 *   `GLOBAL_EXPORT_IGNORE_PATHS`.
 * - The llms plugin ignore list in `config.mts` and the edge-function blacklist
 *   for old blog posts are related but currently separate; keep them aligned
 *   when changing historical export coverage.
 */
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'
import { parse as parseYaml } from 'yaml'

type ExportMode = `off` | `parse-html` | `source-with-explicit`

type ExportTarget = {
  mode: ExportMode
  modeExplicit: boolean
  selector: string
  toMarkdownPath: (relativeHtmlPath: string) => string
  sourcePath: string
  sourceFrontmatter: Record<string, unknown>
  sourceBody: string
  title?: string | null
  titleSelector?: string
  ignoreSelectors?: string[]
}

type ExportOverride = {
  matches: (relativeHtmlPath: string) => boolean
  selector?: string
  titleSelector?: string
  ignoreSelectors?: string[]
}

const DEFAULT_EXPORT_MODE: ExportMode = `source-with-explicit`
const DEFAULT_PARSE_HTML_SELECTOR = `[data-md-export="parse-html"]`
const DEFAULT_SOURCE_WITH_EXPLICIT_SELECTOR = `.main .vp-doc`
const GLOBAL_EXPORT_IGNORE_PATHS = new Set([`404.html`, `old-index.html`])

const DEFAULT_IGNORE_SELECTORS = [
  `.md-exclude`,
  `[data-md-export="ignore"]`,
  `[style*="display: none"]`,
  `[style*="display:none"]`,
  `script`,
  `style`,
  `noscript`,
  `svg`,
  `canvas`,
  `audio`,
  `video`,
  `iframe`,
  `.copy`,
  `.header-anchor`,
  `.lang`,
]

const EXPORT_OVERRIDES: ExportOverride[] = [
  {
    matches: (relativeHtmlPath) => relativeHtmlPath === `index.html`,
    titleSelector: `.home-hero-name`,
  },
  {
    matches: (relativeHtmlPath) => relativeHtmlPath === `agents/index.html`,
    ignoreSelectors: [
      `.ea-come-online-visual`,
      `.ea-runtime-diagram`,
      `.ea-durable-demo`,
      `.ea-scale-grid`,
      `.ea-context-demo`,
      `.ea-way-preview`,
      `.ann-marker`,
      `.ea-ann-num`,
    ],
  },
  {
    matches: (relativeHtmlPath) =>
      relativeHtmlPath.startsWith(`blog/`) &&
      relativeHtmlPath !== `blog.html` &&
      relativeHtmlPath.endsWith(`.html`),
    titleSelector: `.post-header h1`,
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null && !Array.isArray(value)
}

function parseMarkdownFrontmatter(markdown: string) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) {
    return {
      frontmatter: {} as Record<string, unknown>,
      body: markdown,
    }
  }

  const parsed = parseYaml(match[1])

  return {
    frontmatter: isRecord(parsed) ? parsed : {},
    body: markdown.slice(match[0].length),
  }
}

function resolveMdExportMode(frontmatter: Record<string, unknown>): ExportMode {
  const value = frontmatter.mdExport

  if (typeof value === `string`) {
    if (
      value === `off` ||
      value === `parse-html` ||
      value === `source-with-explicit`
    ) {
      return value
    }
  }

  if (isRecord(value)) {
    const mode = value.mode
    if (
      mode === `off` ||
      mode === `parse-html` ||
      mode === `source-with-explicit`
    ) {
      return mode
    }
  }

  return DEFAULT_EXPORT_MODE
}

function toMarkdownPath(relativeHtmlPath: string) {
  return relativeHtmlPath.replace(/\.html$/, `.md`)
}

function deriveSourcePathFromHtml(relativeHtmlPath: string) {
  const blogMatch = relativeHtmlPath.match(
    /^blog\/(\d{4})\/(\d{2})\/(\d{2})\/(.+)\.html$/
  )

  if (blogMatch) {
    const [, year, month, day, slug] = blogMatch
    return `blog/posts/${year}-${month}-${day}-${slug}.md`
  }

  return toMarkdownPath(relativeHtmlPath)
}

async function resolveExportTarget(
  exportOutDir: string,
  relativeHtmlPath: string
): Promise<ExportTarget | null> {
  if (GLOBAL_EXPORT_IGNORE_PATHS.has(relativeHtmlPath)) {
    return null
  }

  const sourcePath = deriveSourcePathFromHtml(relativeHtmlPath)
  const websiteRoot = path.resolve(exportOutDir, `..`, `..`)
  const sourceFile = path.join(websiteRoot, sourcePath)

  try {
    await access(sourceFile)
  } catch {
    return null
  }

  const sourceMarkdown = await readFile(sourceFile, `utf8`)
  const { frontmatter, body } = parseMarkdownFrontmatter(sourceMarkdown)
  const modeValue = frontmatter.mdExport
  const mode =
    resolveMdExportMode(frontmatter)
  const modeExplicit = typeof modeValue === `string` || isRecord(modeValue)

  if (mode === `off`) {
    return null
  }

  const override = EXPORT_OVERRIDES.find((candidate) =>
    candidate.matches(relativeHtmlPath)
  )

  return {
    mode,
    modeExplicit,
    selector:
      override?.selector ??
      (mode === `parse-html`
        ? DEFAULT_PARSE_HTML_SELECTOR
        : DEFAULT_SOURCE_WITH_EXPLICIT_SELECTOR),
    toMarkdownPath,
    sourcePath,
    sourceFrontmatter: frontmatter,
    sourceBody: body,
    title:
      typeof frontmatter.title === `string` ? frontmatter.title : null,
    titleSelector: override?.titleSelector,
    ignoreSelectors: override?.ignoreSelectors,
  }
}

function inferFenceLanguage(label: string | null): string {
  if (!label) return ``

  const trimmed = label.trim().toLowerCase()
  const ext = trimmed.split(`.`).pop()

  switch (ext) {
    case `ts`:
      return `ts`
    case `tsx`:
      return `tsx`
    case `js`:
      return `js`
    case `jsx`:
      return `jsx`
    case `json`:
      return `json`
    case `sh`:
      return `sh`
    case `bash`:
      return `bash`
    case `sql`:
      return `sql`
    case `html`:
      return `html`
    case `css`:
      return `css`
    case `yml`:
    case `yaml`:
      return `yaml`
    default:
      return ``
  }
}

function cleanMarkdown(markdown: string): string {
  return markdown
    .replace(/\u00a0/g, ` `)
    .replace(/\$\s*(?=[a-z])/g, `$ `)
    .replace(/\)\[/g, `) [`)
    .replace(/^- {2,}/gm, `- `)
    .replace(/^(\d+\.) {2,}/gm, `$1 `)
    .replace(/[ \t]+\n/g, `\n`)
    .replace(/\n{3,}/g, `\n\n`)
    .replace(/^\d+\.\s+\d+\s*$/gm, ``)
    .replace(/^\s*[⚙✎💬↻▤]\s*$/gm, ``)
    .trim()
}

function prependTitle(markdown: string, title: string | null) {
  const trimmedTitle = title?.trim()
  if (!trimmedTitle) return markdown
  if (markdown.startsWith(`# ${trimmedTitle}\n`)) return markdown

  if (markdown.startsWith(`---\n`)) {
    const frontmatterEnd = markdown.indexOf(`\n---\n`, 4)
    if (frontmatterEnd !== -1) {
      const frontmatter = markdown.slice(0, frontmatterEnd + 5)
      const body = markdown.slice(frontmatterEnd + 5).trimStart()
      if (body.startsWith(`# ${trimmedTitle}\n`)) return markdown
      return `${frontmatter}\n# ${trimmedTitle}\n\n${body}`.trim()
    }
  }

  return `# ${trimmedTitle}\n\n${markdown}`.trim()
}

function normalizeExplicitMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, `\n`).split(`\n`)

  while (lines[0]?.trim() === ``) lines.shift()
  while (lines.at(-1)?.trim() === ``) lines.pop()

  const indents = lines
    .filter((line) => line.trim() !== ``)
    .map((line) => line.match(/^(\s*)/)?.[1].length ?? 0)
  const minIndent = indents.length ? Math.min(...indents) : 0

  return lines.map((line) => line.slice(minIndent)).join(`\n`).trim()
}

function createTurndownService() {
  const service = new TurndownService({
    bulletListMarker: `-`,
    codeBlockStyle: `fenced`,
    headingStyle: `atx`,
    linkStyle: `inlined`,
  })

  service.addRule(`ignore-empty-buttons`, {
    filter: [`button`],
    replacement: (_content, node) => {
      const text = node.textContent?.trim()
      return text ? `${text}\n\n` : ``
    },
  })

  service.addRule(`pre-with-file-header`, {
    filter: (node) => {
      return (
        node.nodeName === `PRE` &&
        node.parentElement?.querySelector(`code`) !== null
      )
    },
    replacement: (_content, node) => {
      const code = node.textContent?.replace(/\n+$/, ``) ?? ``
      if (!code.trim()) return ``

      const previous = node.previousElementSibling
      const label = previous?.classList.contains(`code-file-header`)
        ? previous.textContent?.trim() ?? ``
        : ``
      const language = inferFenceLanguage(label)
      const fence = language ? `\`\`\`${language}` : `\`\`\``
      const title = label ? `${label}\n\n` : ``

      return `\n\n${title}${fence}\n${code}\n\`\`\`\n\n`
    },
  })

  service.addRule(`drop-code-file-header`, {
    filter: (node) =>
      node.nodeName === `DIV` && node.classList.contains(`code-file-header`),
    replacement: () => ``,
  })

  service.addRule(`faq-summary-heading`, {
    filter: [`summary`],
    replacement: (content) => {
      const text = cleanMarkdown(content)
      return text ? `\n\n### ${text}\n\n` : ``
    },
  })

  service.addRule(`details-container`, {
    filter: [`details`],
    replacement: (content) => (content.trim() ? `\n\n${content.trim()}\n\n` : ``),
  })

  service.addRule(`mono-lines`, {
    filter: (node) =>
      (node.nodeName === `DIV` || node.nodeName === `SPAN`) &&
      node.classList.contains(`mono`) &&
      node.children.length === 0,
    replacement: (_content, node) => {
      const text = node.textContent?.trim()
      return text ? `\`${text}\`` : ``
    },
  })

  return service
}

function commentMarkerForLanguage(language: string, number: string) {
  switch (language) {
    case `sh`:
    case `bash`:
    case `yaml`:
      return ` # [${number}]`
    case `sql`:
      return ` -- [${number}]`
    case `css`:
    case `json`:
      return ` /* [${number}] */`
    case `html`:
      return ` <!-- [${number}] -->`
    default:
      return ` // [${number}]`
  }
}

function serializeCodePanel(panel: Element) {
  const pre = panel.querySelector(`pre`)
  if (!pre) return ``

  const label = panel.querySelector(`.code-file-header`)?.textContent?.trim() ?? ``
  const language = inferFenceLanguage(label) || `txt`
  const clone = pre.cloneNode(true) as Element

  for (const marker of Array.from(clone.querySelectorAll(`.ann-marker[data-n]`))) {
    const number = marker.getAttribute(`data-n`)
    marker.replaceWith(
      clone.ownerDocument.createTextNode(
        commentMarkerForLanguage(language, number ?? `?`)
      )
    )
  }

  const code = clone.textContent?.replace(/\n+$/, ``) ?? ``
  if (!code.trim()) return ``

  const fence = language ? `\`\`\`${language}` : `\`\`\``
  const title = label ? `${label}\n\n` : ``
  return `${title}${fence}\n${code}\n\`\`\``
}

function serializeCliPanel(panel: Element) {
  const lines = Array.from(panel.querySelectorAll(`.cli-line, .cli-output`))
    .map((line) => {
      const clone = line.cloneNode(true) as Element
      for (const marker of Array.from(clone.querySelectorAll(`.ann-marker[data-n]`))) {
        const number = marker.getAttribute(`data-n`)
        marker.replaceWith(
          clone.ownerDocument.createTextNode(
            commentMarkerForLanguage(`sh`, number ?? `?`)
          )
        )
      }

      return clone.textContent?.replace(/\u00a0/g, ` `).trim() ?? ``
    })
    .filter(Boolean)

  if (!lines.length) return ``

  return `\`\`\`sh\n${lines.join(`\n`)}\n\`\`\``
}

function serializeAnnotationList(
  items: Element[],
  numberSelector: string,
  turndownService: TurndownService & { turndown: (input: string) => string }
) {
  const lines = items
    .map((item) => {
      const number =
        item.querySelector(numberSelector)?.textContent?.trim() ?? ``
      const title = item.querySelector(`strong`)?.textContent?.trim() ?? ``
      const bodies = Array.from(item.querySelectorAll(`p`))
        .map((p) => cleanMarkdown(turndownService.turndown(p.innerHTML)))
        .filter(Boolean)
      const body = bodies.join(` `)
      if (!number || !title) return ``
      return `${number}. **${title}**${body ? ` ${body}` : ``}`
    })
    .filter(Boolean)

  return lines.join(`\n`)
}

function replaceAnnotatedCodeBlocks(root: Element, document: Document) {
  let tokenIndex = 0
  const tokens: Array<{ token: string; markdown: string }> = []
  const turndownService = createTurndownService() as TurndownService & {
    turndown: (input: string) => string
  }

  for (const block of Array.from(root.querySelectorAll(`.ea-annotated-code`))) {
    const parts = [
      ...Array.from(block.querySelectorAll(`.ea-code-panel`)).map((panel) =>
        serializeCodePanel(panel)
      ),
      ...Array.from(block.querySelectorAll(`.ea-cli-panel`)).map((panel) =>
        serializeCliPanel(panel)
      ),
    ].filter(Boolean)

    const annotations = serializeAnnotationList(
      Array.from(block.querySelectorAll(`.ea-ann-item`)),
      `.ea-ann-num`,
      turndownService
    )

    const markdown = [...parts, annotations].filter(Boolean).join(`\n\n`).trim()
    if (!markdown) continue

    const token = `MDRICHTOKEN${tokenIndex++}`
    block.replaceWith(document.createTextNode(token))
    tokens.push({ token, markdown })
  }

  for (const block of Array.from(root.querySelectorAll(`.sh-first-sync-grid`))) {
    const parts = Array.from(block.querySelectorAll(`.sh-fs-panel`))
      .map((panel) => serializeCodePanel(panel))
      .filter(Boolean)

    const annotations = serializeAnnotationList(
      Array.from(block.querySelectorAll(`.sh-fs-anno`)),
      `.num`,
      turndownService
    )

    const markdown = [...parts, annotations].filter(Boolean).join(`\n\n`).trim()
    if (!markdown) continue

    const token = `MDRICHTOKEN${tokenIndex++}`
    block.replaceWith(document.createTextNode(token))
    tokens.push({ token, markdown })
  }

  for (const block of Array.from(root.querySelectorAll(`.sh-fs-panel`))) {
    if (!block.querySelector(`.sh-inline-annos`)) continue

    const parts = [serializeCodePanel(block)].filter(Boolean)
    const annotations = serializeAnnotationList(
      Array.from(block.querySelectorAll(`.sh-inline-annos li`)),
      `.num`,
      turndownService
    )

    const markdown = [...parts, annotations].filter(Boolean).join(`\n\n`).trim()
    if (!markdown) continue

    const token = `MDRICHTOKEN${tokenIndex++}`
    block.replaceWith(document.createTextNode(token))
    tokens.push({ token, markdown })
  }

  return tokens
}

async function listHtmlFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        return listHtmlFiles(rootDir, entryPath)
      }

      if (entry.isFile() && entry.name.endsWith(`.html`)) {
        return [path.relative(rootDir, entryPath)]
      }

      return []
    })
  )

  return files.flat()
}

function replaceExplicitBlocks(root: Element, document: Document) {
  let explicitIndex = 0
  const tokens: Array<{ token: string; markdown: string }> = []

  for (const node of Array.from(root.querySelectorAll(`[data-md-export="explicit"]`))) {
    const markdown = Array.from(node.querySelectorAll(`[data-md-export="content"]`))
      .map((contentNode) => normalizeExplicitMarkdown(contentNode.textContent ?? ``))
      .filter(Boolean)
      .join(`\n\n`)

    const token = `MDEXPORTTOKEN${explicitIndex++}`
    node.replaceWith(document.createTextNode(token))
    tokens.push({ token, markdown })
  }

  return tokens
}

function injectExplicitMarkdown(
  markdown: string,
  tokens: Array<{ token: string; markdown: string }>
) {
  let output = markdown

  for (const { token, markdown: replacement } of tokens) {
    output = output.replace(token, `\n\n${replacement}\n\n`)
  }

  return output
}

function isAnchorLine(line: string) {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (trimmed.startsWith(`<`) || trimmed.startsWith(`</`)) return false
  return true
}

function normalizeAnchorText(line: string) {
  return line
    .replace(/&nbsp;/g, ` `)
    .replace(/&mdash;/g, `—`)
    .replace(/&ndash;/g, `–`)
    .replace(/&amp;/g, `&`)
    .replace(/\u00a0/g, ` `)
    .replace(/\s+/g, ` `)
    .trim()
}

function findAnchorBefore(source: string) {
  const lines = source.split(`\n`)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isAnchorLine(lines[i])) return normalizeAnchorText(lines[i])
  }
  return null
}

function findAnchorAfter(source: string) {
  const lines = source.split(`\n`)
  for (const line of lines) {
    if (isAnchorLine(line)) return normalizeAnchorText(line)
  }
  return null
}

function extractExplicitInsertionAnchors(sourceBody: string) {
  const explicitComponentRegex =
    /(?:<div\b[^>]*>\s*)?<(YoutubeEmbed|CuratedBlogPosts|BlogPostsByTag|WritesLadder)\b[\s\S]*?\/>(?:\s*<\/div>)?/g

  const insertions: Array<{ beforeAnchor: string | null; afterAnchor: string | null }> = []

  let match: RegExpExecArray | null
  while ((match = explicitComponentRegex.exec(sourceBody)) !== null) {
    const before = sourceBody.slice(0, match.index)
    const after = sourceBody.slice(match.index + match[0].length)
    insertions.push({
      beforeAnchor: findAnchorBefore(before),
      afterAnchor: findAnchorAfter(after),
    })
  }

  return insertions
}

function findAnchorLinePosition(output: string, anchor: string, searchFrom: number) {
  const normalizedAnchor = normalizeAnchorText(anchor)
  const lines = output.split(`\n`)
  let offset = 0

  for (const line of lines) {
    const lineStart = offset
    const lineEnd = lineStart + line.length

    if (lineEnd >= searchFrom && normalizeAnchorText(line) === normalizedAnchor) {
      return { lineStart, lineEnd }
    }

    offset = lineEnd + 1
  }

  return null
}

function spliceExplicitMarkdownIntoBase(
  baseMarkdown: string,
  insertions: Array<{ beforeAnchor: string | null; afterAnchor: string | null }>,
  explicitBlocks: string[]
) {
  let output = baseMarkdown
  let searchFrom = 0

  insertions.forEach((insertion, index) => {
    const replacement = explicitBlocks[index]?.trim()
    if (!replacement) return

    if (insertion.afterAnchor) {
      const nextAnchor = findAnchorLinePosition(output, insertion.afterAnchor, searchFrom)
      if (nextAnchor) {
        output =
          `${output.slice(0, nextAnchor.lineStart)}${replacement}\n\n${output.slice(nextAnchor.lineStart)}`.trim()
        searchFrom = nextAnchor.lineStart + replacement.length
        return
      }
    }

    if (insertion.beforeAnchor) {
      const previousAnchor = findAnchorLinePosition(
        output,
        insertion.beforeAnchor,
        searchFrom
      )
      if (previousAnchor) {
        const insertAt =
          previousAnchor.lineEnd === output.length
            ? output.length
            : previousAnchor.lineEnd + 1
        output =
          `${output.slice(0, insertAt)}\n${replacement}\n${output.slice(insertAt)}`.trim()
        searchFrom = insertAt + replacement.length
        return
      }
    }

    output = `${output}\n\n${replacement}`.trim()
    searchFrom = output.length
  })

  return output
}

async function exportTarget(
  exportOutDir: string,
  destinationOutDir: string,
  relativeHtmlPath: string,
  target: ExportTarget
) {
  if (target.mode === `source-with-explicit`) {
    const htmlFile = path.join(exportOutDir, relativeHtmlPath)
    const generatedMarkdownFile = path.join(
      exportOutDir,
      target.toMarkdownPath(relativeHtmlPath)
    )
    const markdownFile = path.join(
      destinationOutDir,
      target.toMarkdownPath(relativeHtmlPath)
    )
    const websiteRoot = path.resolve(exportOutDir, `..`, `..`)
    const sourceFile = path.join(websiteRoot, target.sourcePath)

    try {
      await Promise.all([access(generatedMarkdownFile), access(sourceFile)])
    } catch {
      return
    }

    const [html, generatedMarkdown] = await Promise.all([
      readFile(htmlFile, `utf8`),
      readFile(generatedMarkdownFile, `utf8`),
    ])

    const dom = new JSDOM(html)
    const { document } = dom.window
    const root = document.querySelector(target.selector ?? `body`)
    const title = target.titleSelector
      ? document.querySelector(target.titleSelector)?.textContent ?? null
      : null

    if (!root) {
      if (!target.modeExplicit) {
        return
      }

      throw new Error(
        `Markdown export selector "${target.selector}" not found in ${relativeHtmlPath}`
      )
    }

    const explicitBlocks = Array.from(
      root.querySelectorAll(`[data-md-export="content"]`)
    )
      .map((node) => node as Element)
      .map((node) => normalizeExplicitMarkdown(node.textContent ?? ``))
      .filter(Boolean)

    const insertions = extractExplicitInsertionAnchors(target.sourceBody)
    const mergedMarkdown = spliceExplicitMarkdownIntoBase(
      generatedMarkdown,
      insertions,
      explicitBlocks
    )
    const resolvedTitle = title ?? target.title ?? null
    const withTitle = prependTitle(cleanMarkdown(mergedMarkdown), resolvedTitle)

    await mkdir(path.dirname(markdownFile), { recursive: true })
    await writeFile(markdownFile, `${withTitle}\n`, `utf8`)
    return
  }

  const htmlFile = path.join(exportOutDir, relativeHtmlPath)
  const markdownFile = path.join(
    destinationOutDir,
    target.toMarkdownPath(relativeHtmlPath)
  )
  const html = await readFile(htmlFile, `utf8`)
  const dom = new JSDOM(html)
  const { document } = dom.window
  const root = document.querySelector(target.selector)
  const title = target.titleSelector
    ? document.querySelector(target.titleSelector)?.textContent ?? null
    : target.title ?? null

  if (!root) {
    if (!target.modeExplicit) {
      return
    }

    throw new Error(
      `Markdown export selector "${target.selector}" not found in ${relativeHtmlPath}`
    )
  }

  const richTokens = replaceAnnotatedCodeBlocks(root, document)
  const explicitTokens = replaceExplicitBlocks(root, document)

  const selectors = [...DEFAULT_IGNORE_SELECTORS, ...(target.ignoreSelectors ?? [])]
  for (const selector of selectors) {
    for (const node of root.querySelectorAll(selector)) {
      node.remove()
    }
  }

  const turndownService = createTurndownService() as TurndownService & {
    turndown: (input: string) => string
  }
  const htmlMarkdown = turndownService.turndown(root.innerHTML)
  const markdown = cleanMarkdown(
    injectExplicitMarkdown(
      injectExplicitMarkdown(htmlMarkdown, richTokens),
      explicitTokens
    )
  )
  const withTitle = prependTitle(markdown, title)

  await mkdir(path.dirname(markdownFile), { recursive: true })
  await writeFile(markdownFile, `${withTitle}\n`, `utf8`)
}

export async function exportMarkedPagesToMarkdown(exportOutDir: string) {
  const destinationOutDir = exportOutDir.endsWith(`dist-markdown`)
    ? path.join(path.dirname(exportOutDir), `dist`)
    : exportOutDir

  const htmlFiles = await listHtmlFiles(exportOutDir)

  for (const relativeHtmlPath of htmlFiles) {
    const target = await resolveExportTarget(exportOutDir, relativeHtmlPath)

    if (!target) continue

    await exportTarget(exportOutDir, destinationOutDir, relativeHtmlPath, target)
  }
}
