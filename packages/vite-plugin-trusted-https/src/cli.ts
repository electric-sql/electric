#!/usr/bin/env node
import { Command } from "commander"
import { existsSync } from "fs"
import { CertificateManager } from "./certificate-manager"
import { TrustInstaller } from "./trust-installer"

const program = new Command()

interface CliOptions {
  certDir: string
  name: string
  domains: string[]
}

function createCertificateManager(options: CliOptions): CertificateManager {
  return new CertificateManager({
    certDir: options.certDir,
    name: options.name,
    domains: options.domains,
  })
}

program
  .name(`trust-certs`)
  .description(`Manage trusted HTTPS certificates for development`)
  .version(`1.0.0`)

program
  .command(`install`)
  .description(`Install certificates to your local user trust store`)
  .option(`-d, --cert-dir <dir>`, `Certificate directory`, `./.certs`)
  .option(`-n, --name <name>`, `Certificate name`, `vite-plugin-trusted-https`)
  .option(`--domains <domains>`, `Comma-separated domains`, `localhost`)
  .action(async (options) => {
    try {
      const opts = {
        certDir: options.certDir,
        name: options.name,
        domains: options.domains.split(`,`).map((d: string) => d.trim()),
      }

      console.log(`Installing certificates`)
      console.log(`Certificate directory: ${opts.certDir}`)
      console.log(`Certificate name: ${opts.name}`)
      console.log(`Domains: ${opts.domains.join(`, `)}`)
      console.log(`Platform: ${process.platform}`)
      console.log()

      const certManager = createCertificateManager(opts)
      const trustInstaller = new TrustInstaller(opts.name)

      // Generate certificates if they don't exist
      let certPaths: { cert: string; key: string }

      if (
        certManager.certificateExists() &&
        !certManager.isCertificateExpired()
      ) {
        console.log(`Using existing certificates`)
        certPaths = {
          cert: certManager.getCertificatePath(),
          key: certManager.getKeyPath(),
        }
      } else {
        console.log(`Generating new certificates...`)
        certPaths = await certManager.ensureCertificates()
        console.log(`Certificates generated`)

        console.log(`XXX certPaths`, certPaths)
      }

      // Install to system trust store with retry loop
      console.log(`Installing to user trust store...`)
      let trustInstalled = false
      let attempts = 0
      const maxAttempts = 10

      while (!trustInstalled && attempts < maxAttempts) {
        attempts++
        const result = await trustInstaller.install(certPaths.cert)

        if (result.success) {
          console.log(`Trusted certificates installed`)
          console.log(`You can now use HTTPS in development without warnings`)

          trustInstalled = true
        } else if (result.userCanceled) {
          const shouldRetry = await trustInstaller.promptUser(
            `Retry certificate installation (Y)? Or fallback to self-signed certificate (n)?`
          )

          if (!shouldRetry) {
            console.log(`Falling back to self-signed certificate`)
            console.log(
              `You'll need to accept security warnings in your browser`
            )

            trustInstalled = true
          }
        } else {
          console.log(`Installation failed: ${result.error}`)

          trustInstalled = true
        }
      }

      if (attempts >= maxAttempts) {
        console.log(
          `Max attempts reached, falling back to self-signed certificate`
        )
      }
    } catch (error) {
      console.error(`❌ Error during installation:`, error)

      process.exit(1)
    }
  })

program
  .command(`remove`)
  .description(`Remove certificates from system trust store`)
  .option(`-n, --name <name>`, `Certificate name`, `vite-plugin-trusted-https`)
  .action(async (options) => {
    try {
      console.log(`Removing certificates from trust store...`)
      console.log(`Certificate name: ${options.name}`)
      console.log(`Platform: ${process.platform}`)
      console.log()

      const trustInstaller = new TrustInstaller(options.name)
      const result = await trustInstaller.remove(``) // Path not needed for removal

      if (result.success) {
        console.log(`Certificates successfully removed`)
      } else {
        console.log(`Removal failed: ${result.error}`)
      }
    } catch (error) {
      console.error(`Error during removal:`, error)

      process.exit(1)
    }
  })

program
  .command(`status`)
  .description(`Check certificate trust status`)
  .option(`-d, --cert-dir <dir>`, `Certificate directory`, `./.certs`)
  .option(`-n, --name <name>`, `Certificate name`, `vite-plugin-trusted-https`)
  .action(async (options) => {
    try {
      const opts = {
        certDir: options.certDir,
        name: options.name,
        domains: [`localhost`], // Default for status check
      }

      console.log(`Certificate Status Report`)
      console.log(`=========================`)
      console.log(`Certificate directory: ${opts.certDir}`)
      console.log(`Certificate name: ${opts.name}`)
      console.log(`Platform: ${process.platform}`)
      console.log()

      const certManager = createCertificateManager(opts)
      const trustInstaller = new TrustInstaller(opts.name)

      // Check if certificates exist
      const certExists = certManager.certificateExists()
      const certPath = certManager.getCertificatePath()
      const keyPath = certManager.getKeyPath()

      console.log(`Certificate Files:`)
      console.log(`- Certificate: ${certPath} ${certExists ? `✅` : `❌`}`)
      console.log(
        `- Private key: ${keyPath} ${existsSync(keyPath) ? `✅` : `❌`}`
      )

      if (certExists) {
        const isExpired = certManager.isCertificateExpired()
        console.log(`- Status: ${isExpired ? `⚠️ Expired/Old` : `✅ Valid`}`)

        // Check if trusted
        const isTrusted = await trustInstaller.checkTrusted(certPath)
        console.log(
          `- Trust status: ${isTrusted ? `✅ Trusted` : `❌ Not Trusted`}`
        )

        if (!isTrusted) {
          console.log(
            `To install trusted certificates run \`trust-certs install\``
          )
        }
      } else {
        console.log(
          `To generate and install certificates run \`trust-certs install\``
        )
      }
    } catch (error) {
      console.error(`Error:`, error)

      process.exit(1)
    }
  })

program
  .command(`generate`)
  .description(`Generate certificates without installing to trust store`)
  .option(`-d, --cert-dir <dir>`, `Certificate directory`, `./.certs`)
  .option(`-n, --name <name>`, `Certificate name`, `vite-plugin-trusted-https`)
  .option(`--domains <domains>`, `Comma-separated domains`, `localhost`)
  .action(async (options) => {
    try {
      const opts = {
        certDir: options.certDir,
        name: options.name,
        domains: options.domains.split(`,`).map((d: string) => d.trim()),
      }

      console.log(`Generating certificates...`)
      console.log(`Certificate directory: ${opts.certDir}`)
      console.log(`Certificate name: ${opts.name}`)
      console.log(`Domains: ${opts.domains.join(`, `)}`)
      console.log()

      const certManager = createCertificateManager(opts)
      const certPaths = await certManager.ensureCertificates()

      console.log(`Certificates generated successfully!`)
      console.log(`Certificate: ${certPaths.cert}`)
      console.log(`Private Key: ${certPaths.key}`)
      console.log()
      console.log(`To trust these certificates run \`trust-certs install\``)
    } catch (error) {
      console.error(`Error generating certificates:`, error)
      process.exit(1)
    }
  })

// Error handling for unknown commands
program.on(`command:*`, (operands) => {
  console.error(`Unknown command: ${operands[0]}`)
  console.log(`Run 'trust-certs --help' for available commands`)
  process.exit(1)
})

// Show help if no command provided
if (process.argv.length <= 2) {
  program.help()
}

program.parse()
