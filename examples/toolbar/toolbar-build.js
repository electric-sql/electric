
const { build } = require("esbuild");
const { dependencies } = require("./package.json");



const inlineImage = require('esbuild-plugin-inline-image')

const entryFile = "src/toolbar/index.tsx";
const shared = {
  bundle: true,
  entryPoints: [entryFile],
  // Treat all dependencies in package.json as externals to keep bundle size to a minimum
  external: Object.keys(dependencies),
  logLevel: "info",
  minify: true,
  sourcemap: true,
};

build({
  ...shared,
  format: "esm",
  outfile: "./dist/index.esm.js",
  target: ["esnext", "node12.22.0"],
  plugins: [inlineImage()],
});

build({
  ...shared,
  format: "cjs",
  outfile: "./dist/index.cjs.js",
  target: ["esnext", "node12.22.0"],
  plugins: [inlineImage()],
});