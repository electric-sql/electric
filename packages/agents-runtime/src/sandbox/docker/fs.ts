import { basename, dirname, posix } from 'node:path'
import { Readable } from 'node:stream'
import type { DirEntry, FileStat } from '../types'
import type { DockerodeContainer } from './loader'

/**
 * Minimal in-memory tar writer for shipping single files / directories into
 * a container via dockerode's `putArchive`. We do not depend on a tar npm
 * library because (a) we only need the v7-ustar variant for our small
 * payloads and (b) avoiding the dep keeps the package install graph slim
 * for users who don't opt into docker.
 */

const BLOCK = 512

function pad(buf: Buffer): Buffer {
  const remainder = buf.length % BLOCK
  if (remainder === 0) return buf
  return Buffer.concat([buf, Buffer.alloc(BLOCK - remainder)])
}

function checksum(header: Buffer): number {
  let sum = 0
  for (let i = 0; i < header.length; i++) sum += header[i]
  return sum
}

function writeOctal(
  buf: Buffer,
  offset: number,
  len: number,
  value: number
): void {
  const str = value.toString(8).padStart(len - 1, `0`) + `\0`
  buf.write(str, offset, len, `ascii`)
}

function buildHeader(opts: {
  name: string
  size: number
  mode: number
  mtimeSec: number
  typeflag: `0` | `5`
}): Buffer {
  const header = Buffer.alloc(BLOCK)
  // Fill checksum field with spaces while we compute the rest.
  header.fill(0x20, 148, 156)

  const nameBuf = Buffer.from(opts.name, `utf-8`)
  if (nameBuf.length > 100) {
    throw new Error(
      `dockerSandbox: file path "${opts.name}" exceeds the 100-byte tar limit. Split via mkdir + writeFile or use a shorter path.`
    )
  }
  header.set(nameBuf, 0)
  writeOctal(header, 100, 8, opts.mode & 0o7777)
  writeOctal(header, 108, 8, 0) // uid
  writeOctal(header, 116, 8, 0) // gid
  writeOctal(header, 124, 12, opts.size)
  writeOctal(header, 136, 12, opts.mtimeSec)
  header.write(opts.typeflag, 156, 1, `ascii`)
  header.write(`ustar\0`, 257, 6, `ascii`)
  header.write(`00`, 263, 2, `ascii`)

  const sum = checksum(header)
  writeOctal(header, 148, 7, sum)
  // Bytes 155+ remain zero (prefix).

  return header
}

/**
 * Build a tar stream containing a single file at the given POSIX path
 * (path is interpreted relative to the archive root — dockerode's
 * `putArchive` accepts a destination `path` that is prepended).
 */
function buildSingleFileTar(name: string, content: Buffer): Buffer {
  const now = Math.floor(Date.now() / 1000)
  const header = buildHeader({
    name,
    size: content.length,
    mode: 0o644,
    mtimeSec: now,
    typeflag: `0`,
  })
  return Buffer.concat([
    header,
    pad(content),
    // Two zero blocks signal end-of-archive.
    Buffer.alloc(BLOCK * 2),
  ])
}

function buildSingleDirTar(name: string): Buffer {
  const now = Math.floor(Date.now() / 1000)
  const trailing = name.endsWith(`/`) ? name : `${name}/`
  const header = buildHeader({
    name: trailing,
    size: 0,
    mode: 0o755,
    mtimeSec: now,
    typeflag: `5`,
  })
  return Buffer.concat([header, Buffer.alloc(BLOCK * 2)])
}

/**
 * Minimal tar reader: parses ustar headers and yields {name, type, content}
 * records. Used for `getFile` (dockerode's `getArchive` returns a tar
 * stream wrapping the requested path).
 */
async function readTarStream(
  stream: NodeJS.ReadableStream
): Promise<
  ReadonlyArray<{ name: string; type: `file` | `directory`; content: Buffer }>
> {
  const chunks: Array<Buffer> = []
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk)
  }
  const buf = Buffer.concat(chunks)
  const out: Array<{
    name: string
    type: `file` | `directory`
    content: Buffer
  }> = []
  let offset = 0
  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK)
    if (header[0] === 0) {
      // End-of-archive (two zero blocks). Stop scanning.
      break
    }
    const rawName = header.subarray(0, 100)
    const nul = rawName.indexOf(0)
    const name = rawName
      .subarray(0, nul === -1 ? rawName.length : nul)
      .toString(`utf-8`)
    const sizeField = header
      .subarray(124, 124 + 12)
      .toString(`ascii`)
      .replace(/\0+$/, ``)
      .trim()
    const size = parseInt(sizeField, 8) || 0
    const typeflag = String.fromCharCode(header[156])
    offset += BLOCK
    const content = buf.subarray(offset, offset + size)
    offset += size
    if (size % BLOCK !== 0) offset += BLOCK - (size % BLOCK)
    out.push({
      name,
      type: typeflag === `5` ? `directory` : `file`,
      content: Buffer.from(content),
    })
  }
  return out
}

/**
 * Write `content` to `absolutePath` inside the container. The path's
 * directory must already exist — we do not create parents implicitly. Use
 * `makeDir` first if needed.
 */
export async function putFile(
  container: DockerodeContainer,
  absolutePath: string,
  content: Buffer | string
): Promise<void> {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content)
  const parent = posix.dirname(absolutePath)
  const name = posix.basename(absolutePath)
  if (!name) {
    throw new Error(
      `dockerSandbox: cannot write to bare directory "${absolutePath}"`
    )
  }
  const tar = buildSingleFileTar(name, buf)
  await container.putArchive(Readable.from(tar), { path: parent })
}

export async function getFile(
  container: DockerodeContainer,
  absolutePath: string
): Promise<Buffer> {
  const stream = await container.getArchive({ path: absolutePath })
  const entries = await readTarStream(stream)
  const wanted = basename(absolutePath)
  const hit =
    entries.find((e) => e.name === wanted || e.name === `${wanted}/`) ??
    entries.find((e) => e.type === `file`)
  if (!hit) {
    const err = new Error(`ENOENT: ${absolutePath}`) as NodeJS.ErrnoException
    err.code = `ENOENT`
    throw err
  }
  if (hit.type !== `file`) {
    throw new Error(`dockerSandbox.readFile: "${absolutePath}" is not a file`)
  }
  return hit.content
}

/**
 * Idempotent recursive mkdir. We model dockerode `putArchive` of a 0-size
 * dir entry, which creates the leaf only — to get recursion we issue one
 * tar per missing component.
 */
export async function makeDir(
  container: DockerodeContainer,
  absolutePath: string,
  opts?: { recursive?: boolean }
): Promise<void> {
  const components = absolutePath.split(`/`).filter(Boolean)
  if (components.length === 0) return
  // /a/b/c → ['/a', '/a/b', '/a/b/c']
  const tail = components[components.length - 1]
  const parent = `/` + components.slice(0, -1).join(`/`)
  if (opts?.recursive) {
    for (let i = 1; i <= components.length; i++) {
      const intermediateParent = `/` + components.slice(0, i - 1).join(`/`)
      const tar = buildSingleDirTar(components[i - 1])
      await container.putArchive(Readable.from(tar), {
        path: intermediateParent === `` ? `/` : intermediateParent,
      })
    }
    return
  }
  const tar = buildSingleDirTar(tail)
  await container.putArchive(Readable.from(tar), { path: parent || `/` })
}

/**
 * `find` based listing — POSIX-portable and avoids fragility with
 * non-printable filenames by using `-print0`. Returns entries relative to
 * `absolutePath` (no leading `./`).
 */
export async function readDir(
  exec: (cmd: ReadonlyArray<string>) => Promise<{
    exitCode: number | null
    stdout: Buffer
    stderr: Buffer
  }>,
  absolutePath: string
): Promise<ReadonlyArray<DirEntry>> {
  // Three POSIX `find -type X` passes — works on both GNU find and
  // BusyBox find (alpine). NUL-delimited output is filename-safe.
  const quoted = shellQuote(absolutePath)
  const r = await exec([
    `sh`,
    `-c`,
    `set -e
echo -n DIRS:
find ${quoted} -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null
echo -n FILES:
find ${quoted} -mindepth 1 -maxdepth 1 -type f -print0 2>/dev/null
echo -n LINKS:
find ${quoted} -mindepth 1 -maxdepth 1 -type l -print0 2>/dev/null`,
  ])
  if (r.exitCode !== 0 && r.stdout.length === 0) {
    const err = new Error(
      r.stderr.toString(`utf-8`) || `readdir failed: ${absolutePath}`
    ) as NodeJS.ErrnoException
    err.code = `ENOENT`
    throw err
  }
  const blob = r.stdout.toString(`utf-8`)
  const segDirs = sliceBetween(blob, `DIRS:`, `FILES:`)
  const segFiles = sliceBetween(blob, `FILES:`, `LINKS:`)
  const segLinks = blob.slice(blob.indexOf(`LINKS:`) + 6)
  const make = (
    segment: string,
    type: DirEntry[`type`]
  ): ReadonlyArray<DirEntry> =>
    segment
      .split(`\0`)
      .filter((s) => s.length > 0)
      .map((p) => ({ name: posix.basename(p), type }))
  return [
    ...make(segDirs, `directory`),
    ...make(segFiles, `file`),
    ...make(segLinks, `symlink`),
  ]
}

function sliceBetween(s: string, start: string, end: string): string {
  const i = s.indexOf(start)
  if (i === -1) return ``
  const startOff = i + start.length
  const j = s.indexOf(end, startOff)
  return s.slice(startOff, j === -1 ? undefined : j)
}

export async function statPath(
  exec: (cmd: ReadonlyArray<string>) => Promise<{
    exitCode: number | null
    stdout: Buffer
    stderr: Buffer
  }>,
  absolutePath: string
): Promise<FileStat> {
  const r = await exec([
    `sh`,
    `-c`,
    `(stat -c '%F|%s|%Y' ${shellQuote(absolutePath)} 2>/dev/null || stat -f '%HT|%z|%m' ${shellQuote(absolutePath)} 2>/dev/null)`,
  ])
  const fields = r.stdout.toString(`utf-8`).trim().split(`|`)
  if (r.exitCode !== 0 || fields.length !== 3) {
    const err = new Error(
      r.stderr.toString(`utf-8`) || `stat: no such file: ${absolutePath}`
    ) as NodeJS.ErrnoException
    err.code = `ENOENT`
    throw err
  }
  const [kind, size, mtime] = fields
  const lowerKind = (kind ?? ``).toLowerCase()
  const type: FileStat[`type`] = lowerKind.includes(`directory`)
    ? `directory`
    : lowerKind.includes(`symbolic`)
      ? `symlink`
      : lowerKind.includes(`regular`) || lowerKind === `file`
        ? `file`
        : `other`
  const mtimeNum = Number(mtime)
  return {
    type,
    size: Number(size) || 0,
    mtimeMs: Number.isFinite(mtimeNum) ? mtimeNum * 1000 : 0,
  }
}

export async function pathExists(
  exec: (cmd: ReadonlyArray<string>) => Promise<{
    exitCode: number | null
    stdout: Buffer
    stderr: Buffer
  }>,
  absolutePath: string
): Promise<boolean> {
  const r = await exec([`test`, `-e`, absolutePath])
  return r.exitCode === 0
}

export async function removePath(
  exec: (cmd: ReadonlyArray<string>) => Promise<{
    exitCode: number | null
    stdout: Buffer
    stderr: Buffer
  }>,
  absolutePath: string,
  opts?: { recursive?: boolean }
): Promise<void> {
  const cmd = opts?.recursive
    ? [`rm`, `-r`, absolutePath]
    : [`rm`, absolutePath]
  const r = await exec(cmd)
  if (r.exitCode !== 0) {
    const err = new Error(
      r.stderr.toString(`utf-8`) || `remove failed: ${absolutePath}`
    ) as NodeJS.ErrnoException
    if (/No such file/i.test(r.stderr.toString(`utf-8`))) err.code = `ENOENT`
    else if (/Permission denied/i.test(r.stderr.toString(`utf-8`)))
      err.code = `EACCES`
    else if (
      /Is a directory|directory not empty/i.test(r.stderr.toString(`utf-8`))
    )
      err.code = `EISDIR`
    else err.code = `EIO`
    throw err
  }
}

function shellQuote(arg: string): string {
  return `'` + arg.replace(/'/g, `'\\''`) + `'`
}

void dirname // keep imported for readability when extending
