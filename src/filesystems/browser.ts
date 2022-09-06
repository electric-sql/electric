/*

  We have a few different approaches:

  1. downloading over the web
  2. loading via bundler plugins
  3. pre-bundling into js/ts ourselves

  In either can, we may need a manifest file.

  ## 1. Downloading

  This is how the SQL.js wasm file is loaded -- we provide a url path
  and download the wasm file. For migrations, assuming something like
  the following folder structure:

      ./migrations/
        1234-some-migration/
          a.sql
          b.sql
          ...
        ...

  Then we need some kind of directory indexing. This is probably easiest
  done with something like a `manifest.json` file at the root, which could
  contain the tree structure to all the files.

  It's worth noting that loading files individually over multiple requests
  may be quite slow/inefficient, vs loading in one big file. A single file
  will also provide an opportunity for better transport layer compression.
  So it could be that the manifest file should also just include the sql
  source as inlined strings.

  One downside of this may be adding new migrations -- would you then have
  to re-download the new ones? Perhaps a manifest file and cached downloads
  will be more efficient in the long run?

  ## 2. Bundler plugins

  A combination of file/copy loaders and something like
  https://github.com/thomaschaaf/esbuild-plugin-import-glob means you can
  load the migrations into the source code.

  This is more efficient to load locally than over the internet. It does
  mean the user needs to configure the right plugin for their bundler
  and we have to cover *a lot* of bundlers -- Esbuild, Rollup, Webpack,
  Browserify, Parcel, ... whatever is hot next week, ... etc.

  ## 3. Pre-bundling

  An alternative to having the user's js bundler do the bundling is to
  do it ourselves using our CLI tool. We are already envisaging generating
  the output folder and with 1 above a manifest file, possibly with the
  source inline.

  What if we just generated a javascript file that the user could provide
  the import path to? That way, if you're building your app with the locally
  "bundled" migrations, we can smooth over the differences in build tooling
  and basically generate a single "manifest" file in javascript format that
  is loaded locally.

  It strikes me this is the best solution. @paulharter -- what do you think?

  ## Bonus?

  If we do go with (3) perhaps it removes the need for our filesystem
  adapter/absraction and all the target environments can just read the
  migrations SQL from the generated js file?


*/

import { File, Filesystem } from './index'

export class BrowserFile implements File {
  name: string
  path: string

  constructor(name: string, path: string) {
    this.name = name
    this.path = path
  }
}

export class BrowserFilesystem implements Filesystem {
  async listDirectory(_path: string): Promise<BrowserFile[]> {
    // const normalisedPath = path.endsWith('/') ? path.slice(0, -1) : path

    throw 'NotImplemented'

    return []
  }

  async readFile(_file: BrowserFile): Promise<string> {
    throw 'NotImplemented'

    return ''
  }
}
