import { getCertificate } from "@vitejs/plugin-basic-ssl"
import { existsSync, mkdirSync, statSync, writeFileSync } from "fs"
import { join } from "path"
import { MkcertManager } from "./mkcert-manager"

export interface CertificateOptions {
  certDir: string
  domains: string[]
  name: string
}

export interface CertificateResult {
  cert: string
  key: string
  method: 'mkcert' | 'basic-ssl'
}

export class CertificateManager {
  private options: CertificateOptions
  private mkcertManager: MkcertManager

  constructor(options: CertificateOptions) {
    this.options = options
    this.mkcertManager = new MkcertManager(
      options.certDir,
      options.domains,
      options.name
    )
  }

  async ensureCertificates(): Promise<CertificateResult> {
    // Ensure certificate directory exists
    if (!existsSync(this.options.certDir)) {
      mkdirSync(this.options.certDir, { recursive: true })
    }

    // Try mkcert first (best experience - automatically trusted)
    if (this.mkcertManager.isAvailable() && this.mkcertManager.isCAInstalled()) {
      const mkcertResult = await this.mkcertManager.generateCertificates()
      if (mkcertResult.success && mkcertResult.certPath && mkcertResult.keyPath) {
        return {
          cert: mkcertResult.certPath,
          key: mkcertResult.keyPath,
          method: 'mkcert'
        }
      }
    }

    // Fallback to basic-ssl approach
    return this.generateBasicSSLCertificates()
  }

  private async generateBasicSSLCertificates(): Promise<CertificateResult> {
    // Use basic-ssl to generate certificates (returns combined cert+key content)
    const certContent = await getCertificate(
      this.options.certDir,
      this.options.name,
      this.options.domains
    )

    // Split the content into key and certificate parts for compatibility
    const parts = certContent.split(`-----END RSA PRIVATE KEY-----`)
    if (parts.length !== 2) {
      throw new Error(`Invalid certificate format returned from basic-ssl`)
    }

    const keyContent = parts[0] + `-----END RSA PRIVATE KEY-----`
    const certOnly = parts[1].trim()

    // Write the separated files for compatibility
    const certPath = this.getCertificatePath()
    const keyPath = this.getKeyPath()
    
    // Also write the original combined file for direct use
    const combinedPath = this.getCombinedCertificatePath()

    writeFileSync(keyPath, keyContent)
    writeFileSync(certPath, certOnly)
    writeFileSync(combinedPath, certContent)

    console.log(`[certificate-manager] Generated certificate files:`)
    console.log(`  - Cert: ${certPath} (${certOnly.length} bytes)`)
    console.log(`  - Key: ${keyPath} (${keyContent.length} bytes)`)
    console.log(`  - Combined: ${combinedPath} (${certContent.length} bytes)`)

    return { cert: certPath, key: keyPath, method: 'basic-ssl' }
  }

  getCertificatePath(): string {
    return join(this.options.certDir, `${this.options.name}.crt`)
  }

  getKeyPath(): string {
    return join(this.options.certDir, `${this.options.name}.key`)
  }

  getCombinedCertificatePath(): string {
    return join(this.options.certDir, `${this.options.name}-combined.pem`)
  }

  certificateExists(): boolean {
    const certPath = this.getCertificatePath()
    const keyPath = this.getKeyPath()
    const combinedPath = this.getCombinedCertificatePath()
    return existsSync(certPath) && existsSync(keyPath) && existsSync(combinedPath)
  }

  isCertificateExpired(): boolean {
    if (!this.certificateExists()) {
      return true
    }

    try {
      const certPath = this.getCertificatePath()
      const stats = statSync(certPath)
      const ageInDays =
        (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24)

      // Consider certificate expired if older than 30 days
      return ageInDays > 30
    } catch {
      return true
    }
  }

  async renewIfNeeded(): Promise<CertificateResult> {
    if (this.isCertificateExpired()) {
      console.log(`Certificate expired or missing, regenerating...`)
      return this.ensureCertificates()
    }
    
    // Return existing certificates - try to detect method used
    const certPath = this.getCertificatePath()
    const keyPath = this.getKeyPath()
    
    // Simple heuristic: mkcert certificates typically have different formatting
    // This is best-effort since we can't definitively know the method after the fact
    let method: 'mkcert' | 'basic-ssl' = 'basic-ssl'
    if (this.mkcertManager.isAvailable() && this.mkcertManager.isCAInstalled()) {
      method = 'mkcert' // Assume mkcert if it's available and configured
    }
    
    return { cert: certPath, key: keyPath, method }
  }

  getMkcertSetupInstructions(): string {
    return this.mkcertManager.getSetupInstructions()
  }
}
