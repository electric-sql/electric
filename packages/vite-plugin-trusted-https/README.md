# @electric-sql/vite-plugin-trusted-https

A Vite plugin that automatically generates and trusts HTTPS certificates for development, enabling HTTP/2 multiplexing for ElectricSQL.

## Why this plugin?

Electric's shape delivery benefits from HTTP/2 multiplexing. Without HTTP/2, each shape subscription creates a new HTTP/1.1 connection, which browsers limit to 6 concurrent connections per domain. This creates a bottleneck that [makes shapes appear slow](https://electric-sql.com/docs/guides/troubleshooting#slow-shapes-mdash-why-are-my-shapes-slow-in-the-browser-in-local-development).

This plugin provides:

- automatic HTTPS certificate generation
- cross-platform certificate trust (macOS, Linux, Windows)
- HTTP/2 multiplexing support
- graceful fallbacks for development
- CLI tools for certificate management
- zero external dependencies

## Installation

```bash
pnpm install @electric-sql/vite-plugin-trusted-https
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import trustedHttps from '@electric-sql/vite-plugin-trusted-https'

export default defineConfig({
  plugins: [
    trustedHttps() // Add the plugin
  ]
})
```

Start your dev server as usual:

```bash
pnpm run dev
```

The plugin will generate SSL certificates, install them to your system trust store, enable HTTPS with HTTP/2 support, and provide instructions if manual setup is needed.

## Configuration

```ts
trustedHttps({
  // Certificate storage directory
  certDir: './.certs',
  
  // Domains to include in the certificate
  domains: ['localhost', '*.localhost'],
  
  // Automatically attempt to trust certificates
  autoTrust: true,
  
  // Continue without HTTPS if setup fails
  fallback: true,
  
  // Certificate name for system trust store
  name: 'vite-plugin-trusted-https'
})
```

### Options

- `certDir` (string): directory where certificates are stored. Default: `./.certs`
- `domains` (string[]): domains to include in the certificate. Default: `['localhost']`
- `autoTrust` (boolean): automatically attempt certificate trust installation. Default: `true`
- `fallback` (boolean): continue development without HTTPS if certificate setup fails. Default: `true`
- `name` (string): name used for the certificate in system trust stores. Default: `'vite-plugin-trusted-https'`

## CLI commands

### Install certificates

```bash
npx trust-certs install
npx trust-certs install --cert-dir ./certs --name my-cert --domains localhost,example.localhost
```

### Check status

```bash
npx trust-certs status
```

### Generate certificates

```bash
npx trust-certs generate
```

### Remove certificates

```bash
npx trust-certs remove
```

## Platform support

### macOS

- uses `security` command to install to user keychain

### Linux

- uses `update-ca-certificates` with user trust store

### Windows

- uses `certutil` to install to user certificate store

## Debugging

### Status endpoint

Visit `/.vite-trusted-https-status` to see plugin information:

```json
{
  "plugin": "vite-plugin-trusted-https",
  "isSetup": true,
  "certificatePaths": {
    "cert": "./.certs/vite-plugin-trusted-https.crt",
    "key": "./.certs/vite-plugin-trusted-https.key"
  },
  "certificateMethod": "mkcert",
  "trustStatus": {
    "trusted": true
  },
  "platform": "darwin",
  "options": {
    "certDir": "./.certs",
    "domains": ["localhost"],
    "autoTrust": true,
    "fallback": true
  }
}
```

The `certificateMethod` field shows whether `mkcert` or `basic-ssl` was used for certificate generation.

### Common issues

#### Certificate not trusted

If you see SSL warnings:

1. check trust status: `npx trust-certs status`
2. install certificates: `npx trust-certs install`
3. restart your browser
4. clear browser cache if needed

#### Permission denied (macOS/Linux)

The plugin falls back to user-level trust stores if system-level installation fails. You can also run:

```bash
sudo npx trust-certs install
```

#### For the best experience: use mkcert

Install mkcert for zero-friction trusted certificates:

**macOS:**
```bash
brew install mkcert
mkcert -install
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt install mkcert
mkcert -install
```

**Other platforms:**
See [mkcert installation guide](https://github.com/FiloSottile/mkcert#installation)

After installing mkcert, the plugin will automatically use it for certificate generation, eliminating all manual trust steps and sudo prompts.

#### Certificate expired

Certificates are automatically renewed if older than 30 days. To force renewal:

1. remove old certificates: `npx trust-certs remove`
2. install new ones: `npx trust-certs install`

## How it works

The plugin uses a smart fallback strategy for certificate generation and trust:

### 1. Certificate Generation Hierarchy

1. **mkcert (preferred)**: If `mkcert` is installed and configured, generates automatically trusted certificates with zero manual setup
2. **basic-ssl (fallback)**: Uses `@vitejs/plugin-basic-ssl` to generate self-signed certificates, then attempts automatic trust installation

### 2. Trust Installation

- **mkcert certificates**: Automatically trusted by all browsers (no additional setup needed)
- **Self-signed certificates**: Installed to system trust stores using platform-specific commands
- **Manual fallback**: Provides instructions if automatic installation fails

### 3. HTTP/2 Support

Modern browsers automatically use HTTP/2 with trusted HTTPS certificates, providing optimal performance for Electric SQL's shape delivery.

## Electric integration

Works with any Vite project. For Electric:

```ts
const shapes = [
  { url: '/api/todos' },
  { url: '/api/users' },
  { url: '/api/projects' }
]

// All shapes load concurrently over HTTP/2
await Promise.all(
  shapes.map(shape => electric.shapes.subscribe(shape))
)
```

## Security notes

- certificates are self-signed and intended for development only
- certificates use RSA 2048-bit keys with SHA-256 signatures
- private keys are stored locally in the certificate directory
- only domains you specify are included in the certificate

## Migration from Caddy

1. remove Caddy plugin and dependencies
2. add this plugin to your Vite config
3. remove Caddy configuration files
4. update your development documentation

## Development and testing

### Test levels

- `pnpm test` - run all unit tests (fast, no system modification)
- `pnpm test:unit` - unit tests only (mocked dependencies)
- `pnpm test:integration` - integration tests (real certificate generation, no system trust store modification)
- `pnpm test:integration:full` - full system integration tests (modifies system trust store, may trigger security popups on macOS)

The full integration tests will prompt for keychain access on macOS as they test real certificate installation.