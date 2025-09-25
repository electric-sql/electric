import type { Plugin, ViteDevServer } from "vite"
import { readFileSync, existsSync } from "fs"
import {
  CertificateManager,
  type CertificateResult,
} from "./certificate-manager"
import { TrustInstaller } from "./trust-installer"

interface TrustedHttpsOptions {
  certDir?: string
  domains?: string[]
  autoTrust?: boolean
  fallback?: boolean
  name?: string
}

interface PluginState {
  certificateManager: CertificateManager
  trustInstaller: TrustInstaller
  isSetup: boolean
  certResult?: CertificateResult
  trustStatus?: {
    trusted: boolean
  }
}

export default function trustedHttps(
  options: TrustedHttpsOptions = {}
): Plugin {
  const opts = {
    certDir: `./.certs`,
    domains: [`localhost`],
    autoTrust: true,
    fallback: true,
    name: `vite-plugin-trusted-https`,
    ...options,
  }

  const state: PluginState = {
    certificateManager: new CertificateManager({
      certDir: opts.certDir,
      domains: opts.domains,
      name: opts.name,
    }),
    trustInstaller: new TrustInstaller(opts.name),
    isSetup: false,
  }

  async function setupCertificates(): Promise<void> {
    if (state.isSetup) return

    try {
      console.log(`[trusted-https] Setting up HTTPS certificates...`)

      // Generate/renew certificates
      state.certResult = await state.certificateManager.renewIfNeeded()

      // Log which certificate generation method was used
      if (state.certResult.method === `mkcert`) {
        console.log(
          `[trusted-https] Generated certificate using mkcert (automatically trusted)`
        )

        state.trustStatus = { trusted: true }
        state.isSetup = true

        return
      } else {
        console.log(`[trusted-https] Generated certificate using basic-ssl`)
      }

      // For basic-ssl certificates, attempt to trust them if autoTrust is enabled
      if (opts.autoTrust) {
        const isTrusted = await state.trustInstaller.checkTrusted(
          state.certResult.cert
        )

        if (isTrusted) {
          console.log(`[trusted-https] Certificate already trusted`)

          state.trustStatus = { trusted: true }
        } else {
          // Attempt installation with retry loop for user cancellation
          let trustInstalled = false
          let attempts = 0
          const maxAttempts = 10 // Prevent infinite loop

          while (!trustInstalled && attempts < maxAttempts) {
            attempts++

            console.log(
              `[trusted-https] Installing certificate to user trust store ...`
            )

            const trustResult = await state.trustInstaller.install(
              state.certResult.cert
            )

            if (trustResult.success) {
              console.log(`[trusted-https] Trusted certificate installed`)

              state.trustStatus = { trusted: true }
              trustInstalled = true
            } else if (trustResult.userCanceled) {
              // User canceled - ask if they want to continue with self-signed
              console.log(`[trusted-https] Installation not authorized`)

              const shouldRetry = await state.trustInstaller.promptUser(
                `Retry certificate installation (Y)? Or fallback to self-signed certificate (n)?`
              )

              if (!shouldRetry) {
                console.log(
                  `[trusted-https] Falling back to self-signed certificate`
                )
                console.log(
                  `[trusted-https] You'll need to accept security warnings in your browser`
                )

                state.trustStatus = { trusted: false }
                trustInstalled = true // Exit loop, user chose self-signed
              }
            } else {
              console.log(
                `[trusted-https] Installation failed:`,
                trustResult.error
              )

              state.trustStatus = { trusted: false }
              trustInstalled = true // Exit loop, other error
            }
          }

          if (attempts >= maxAttempts) {
            console.log(
              `[trusted-https] Max attempts reached, falling back to self-signed certificate`
            )
            state.trustStatus = { trusted: false }
          }
        }
      } else {
        // Check if already trusted without installing
        const isTrusted = await state.trustInstaller.checkTrusted(
          state.certResult.cert
        )
        state.trustStatus = { trusted: isTrusted }

        if (!isTrusted) {
          console.log(`[trusted-https] Certificate not trusted.`)
        }
      }

      state.isSetup = true
    } catch (error) {
      console.error(`[trusted-https] Failed to setup certificates:`, error)

      if (opts.fallback) {
        console.log(`[trusted-https] Continuing without HTTPS`)
      } else {
        throw error
      }
    }
  }

  return {
    name: `trusted-https`,

    async buildStart() {
      // console.log(`[trusted-https] Plugin initialized with options:`, {
      //   certDir: opts.certDir,
      //   domains: opts.domains,
      //   autoTrust: opts.autoTrust,
      //   fallback: opts.fallback,
      // })
    },

    async configResolved(config) {
      await setupCertificates()

      // Configure HTTPS if certificates are available
      if (state.certResult) {
        try {
          // console.log(`[trusted-https] DEBUG: Reading cert from: ${state.certResult.cert}`)
          // console.log(`[trusted-https] DEBUG: Reading key from: ${state.certResult.key}`)

          let httpsConfig

          if (state.certResult.method === `basic-ssl`) {
            const combinedPath =
              state.certificateManager.getCombinedCertificatePath()
            if (existsSync(combinedPath)) {
              const combinedContent = readFileSync(combinedPath, `utf8`)

              // Use the same approach as @vitejs/plugin-basic-ssl:
              // Set both cert and key to the same combined PEM string
              httpsConfig = { cert: combinedContent, key: combinedContent }
            } else {
              // Fallback to reading separate files and combining them
              const cert = readFileSync(state.certResult.cert, `utf8`)
              const key = readFileSync(state.certResult.key, `utf8`)

              // Certificate should come first, then key for proper certificate chain
              const combinedContent = cert + `\n` + key
              httpsConfig = { cert: combinedContent, key: combinedContent }
            }
          } else {
            // Mkcert certificates
            const cert = readFileSync(state.certResult.cert, `utf8`)
            const key = readFileSync(state.certResult.key, `utf8`)
            const combinedContent = cert + `\n` + key
            httpsConfig = { cert: combinedContent, key: combinedContent }
          }

          // Apply HTTPS configuration to config (like @vitejs/plugin-basic-ssl)
          if (config.server.https === undefined || !!config.server.https) {
            config.server.https = Object.assign(
              {},
              config.server.https,
              httpsConfig
            )
          }
          if (config.preview.https === undefined || !!config.preview.https) {
            config.preview.https = Object.assign(
              {},
              config.preview.https,
              httpsConfig
            )
          }

          const trustStatus = state.trustStatus?.trusted
            ? `trusted`
            : `untrusted`
          console.log(
            `[trusted-https] HTTPS enabled with ${state.certResult.method} certificates (${trustStatus})`
          )
        } catch (error) {
          console.error(
            `[trusted-https] Failed to read certificate files:`,
            error
          )

          if (!opts.fallback) {
            throw error
          }
        }
      }
    },

    configureServer(server: ViteDevServer) {
      // Add status endpoint for debugging
      server.middlewares.use(`/.vite-trusted-https-status`, (_req, res) => {
        res.setHeader(`Content-Type`, `application/json`)
        res.end(
          JSON.stringify(
            {
              plugin: `vite-plugin-trusted-https`,
              isSetup: state.isSetup,
              certificatePaths: state.certResult
                ? {
                    cert: state.certResult.cert,
                    key: state.certResult.key,
                  }
                : null,
              certificateMethod: state.certResult?.method || null,
              trustStatus: state.trustStatus,
              platform: process.platform,
              options: opts,
            },
            null,
            2
          )
        )
      })
    },
  }
}

export type { TrustedHttpsOptions }
