import { execSync } from "child_process"
import { existsSync, readFileSync } from "fs"
import { join } from "path"

export interface MkcertResult {
  success: boolean
  error?: string
  certPath?: string
  keyPath?: string
}

export class MkcertManager {
  private certDir: string
  private domains: string[]
  private name: string

  constructor(certDir: string, domains: string[], name: string) {
    this.certDir = certDir
    this.domains = domains
    this.name = name
  }

  /**
   * Check if mkcert is installed and available
   */
  isAvailable(): boolean {
    try {
      execSync(`mkcert -version`, { stdio: `pipe`, timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if mkcert CA is installed (no sudo needed for cert generation)
   */
  isCAInstalled(): boolean {
    try {
      const caRoot = execSync(`mkcert -CAROOT`, {
        stdio: `pipe`,
        encoding: `utf8`,
        timeout: 5000,
      }).trim()

      // Check if CA files exist
      const rootCAPath = join(caRoot, `rootCA.pem`)
      const rootCAKeyPath = join(caRoot, `rootCA-key.pem`)

      return existsSync(rootCAPath) && existsSync(rootCAKeyPath)
    } catch {
      return false
    }
  }

  /**
   * Generate certificates using mkcert
   */
  async generateCertificates(): Promise<MkcertResult> {
    if (!this.isAvailable()) {
      return {
        success: false,
        error: `mkcert not available`,
      }
    }

    if (!this.isCAInstalled()) {
      return {
        success: false,
        error: `mkcert CA not installed (run 'mkcert -install' first)`,
      }
    }

    try {
      // Generate certificate files
      const certPath = join(this.certDir, `${this.name}.crt`)
      const keyPath = join(this.certDir, `${this.name}.key`)

      // Run mkcert to generate certificates
      const domainsArg = this.domains.join(` `)
      execSync(
        `cd "${this.certDir}" && mkcert -cert-file "${this.name}.crt" -key-file "${this.name}.key" ${domainsArg}`,
        {
          stdio: `pipe`,
          timeout: 30000,
        }
      )

      // Verify the files were created
      if (!existsSync(certPath) || !existsSync(keyPath)) {
        return {
          success: false,
          error: `mkcert did not generate expected certificate files`,
        }
      }

      // Verify the certificate content is valid
      try {
        readFileSync(certPath, `utf8`)
        readFileSync(keyPath, `utf8`)
      } catch {
        return {
          success: false,
          error: `Generated certificate files are not readable`,
        }
      }

      return {
        success: true,
        certPath,
        keyPath,
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : `Unknown error during mkcert generation`,
      }
    }
  }

  /**
   * Get setup instructions for mkcert
   */
  getSetupInstructions(): string {
    const installCmd =
      process.platform === `darwin`
        ? `brew install mkcert && mkcert -install`
        : process.platform === `linux`
          ? `# Install mkcert (varies by distro)\n# Ubuntu/Debian: apt install mkcert\n# Then: mkcert -install`
          : `# Install mkcert from https://github.com/FiloSottile/mkcert\n# Then: mkcert -install`

    return `For a better development experience, install mkcert for automatically trusted certificates:\n\n${installCmd}\n\nThis eliminates the need for manual certificate trust and sudo prompts.`
  }
}
