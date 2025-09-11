import { execSync } from "child_process"
import { existsSync } from "fs"
import * as readline from "readline"

export interface TrustResult {
  success: boolean
  error?: string
  userCanceled?: boolean
}

export class TrustInstaller {
  private certName: string

  constructor(certName = `Electric Dev`) {
    this.certName = certName
  }

  async install(certPath: string): Promise<TrustResult> {
    if (!existsSync(certPath)) {
      return {
        success: false,
        error: `Certificate file not found: ${certPath}`,
      }
    }

    try {
      switch (process.platform) {
        case `darwin`:
          return this.installMacOS(certPath)
        case `linux`:
          return this.installLinux(certPath)
        case `win32`:
          return this.installWindows(certPath)
        default:
          return {
            success: false,
            error: `Platform ${process.platform} not supported. Please manually trust the certificate at: ${certPath}`,
          }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : `Unknown error`,
      }
    }
  }

  async remove(_certPath: string): Promise<TrustResult> {
    try {
      switch (process.platform) {
        case `darwin`:
          return this.removeMacOS()
        case `linux`:
          return this.removeLinux()
        case `win32`:
          return this.removeWindows()
        default:
          return {
            success: false,
            error: `Platform ${process.platform} not supported for automatic removal`,
          }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : `Unknown error`,
      }
    }
  }

  private installMacOS(certPath: string): TrustResult {
    try {
      // Only try user keychain (no sudo required)
      execSync(
        `security add-trusted-cert -d -r trustRoot -k ~/Library/Keychains/login.keychain "${certPath}"`,
        { stdio: `pipe`, timeout: 30000 }
      )
      return { success: true }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)

      // Check if user canceled the operation
      if (
        errorMessage.includes(`User interaction is not allowed`) ||
        errorMessage.includes(`User canceled`) ||
        errorMessage.includes(`errSecUserCanceled`)
      ) {
        return {
          success: false,
          userCanceled: true,
          error: `User canceled certificate installation`,
        }
      }

      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  private installLinux(certPath: string): TrustResult {
    try {
      // Try user-level NSS database (used by Firefox and many applications) - no sudo required
      execSync(
        `certutil -A -n "vite-plugin-trusted-https" -t "C,," -d ~/.pki/nssdb -i "${certPath}"`,
        { stdio: `pipe`, timeout: 30000 }
      )
      return { success: true }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)

      // Check if user canceled or if NSS database doesn't exist
      if (
        errorMessage.includes(`canceled`) ||
        errorMessage.includes(`permission denied`) ||
        errorMessage.includes(`No such file or directory`)
      ) {
        return {
          success: false,
          userCanceled: true,
          error: `User-level certificate installation failed or was canceled`,
        }
      }

      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  private installWindows(certPath: string): TrustResult {
    try {
      // Use user-level certificate store (no admin/UAC required)
      execSync(`certutil -addstore -user root "${certPath}"`, {
        stdio: `pipe`,
        timeout: 30000,
      })
      return { success: true }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)

      // Check if user canceled UAC or other user interaction
      if (
        errorMessage.includes(`canceled`) ||
        errorMessage.includes(`User canceled`) ||
        errorMessage.includes(`operation was cancelled`) ||
        errorMessage.includes(`access denied`)
      ) {
        return {
          success: false,
          userCanceled: true,
          error: `User canceled certificate installation`,
        }
      }

      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  private removeMacOS(): TrustResult {
    try {
      execSync(
        `sudo security delete-certificate -c "${this.certName}" /Library/Keychains/System.keychain`,
        { stdio: `pipe`, timeout: 30000 }
      )
      return { success: true }
    } catch (error) {
      // Try user keychain
      try {
        execSync(
          `security delete-certificate -c "${this.certName}" ~/Library/Keychains/login.keychain`,
          { stdio: `pipe`, timeout: 30000 }
        )
        return { success: true }
      } catch (fallbackError) {
        return {
          success: false,
          error: `Could not remove certificate automatically. Please remove manually from Keychain Access.`,
        }
      }
    }
  }

  private removeLinux(): TrustResult {
    try {
      execSync(
        `sudo rm -f /usr/local/share/ca-certificates/vite-plugin-trusted-https.crt`,
        {
          stdio: `pipe`,
          timeout: 30000,
        }
      )
      execSync(`sudo update-ca-certificates`, { stdio: `pipe`, timeout: 30000 })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: `Could not remove certificate automatically`,
      }
    }
  }

  private removeWindows(): TrustResult {
    try {
      execSync(`certutil -delstore root "${this.certName}"`, {
        stdio: `pipe`,
        timeout: 30000,
      })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: `Could not remove certificate automatically`,
      }
    }
  }

  async checkTrusted(certPath: string): Promise<boolean> {
    if (!existsSync(certPath)) {
      return false
    }

    try {
      switch (process.platform) {
        case `darwin`:
          return this.checkTrustedMacOS(certPath)
        case `linux`:
          return this.checkTrustedLinux()
        case `win32`:
          return this.checkTrustedWindows()
        default:
          return false
      }
    } catch {
      return false
    }
  }

  private checkTrustedMacOS(certPath: string): boolean {
    try {
      // Try to verify using security command
      const result = execSync(
        `security verify-cert -c "${certPath}" 2>/dev/null || echo "UNTRUSTED"`,
        { stdio: `pipe`, encoding: `utf8`, timeout: 10000 }
      )
      return !result.includes(`UNTRUSTED`)
    } catch {
      return false
    }
  }

  private checkTrustedLinux(): boolean {
    try {
      // Check if our certificate exists in the trust store
      return existsSync(
        `/usr/local/share/ca-certificates/vite-plugin-trusted-https.crt`
      )
    } catch {
      return false
    }
  }

  private checkTrustedWindows(): boolean {
    try {
      // List certificates in root store and check for our cert name
      const result = execSync(`certutil -store root`, {
        stdio: `pipe`,
        encoding: `utf8`,
        timeout: 10000,
      })
      return result.includes(this.certName)
    } catch {
      return false
    }
  }

  getManualInstructions(certPath: string): string {
    switch (process.platform) {
      case `darwin`:
        return `Please manually trust the certificate:\n1. Open Keychain Access\n2. File > Import Items\n3. Select: ${certPath}\n4. Double-click the certificate\n5. Expand "Trust" section\n6. Set "When using this certificate" to "Always Trust"`
      case `linux`:
        return `Please manually trust the certificate:\nsudo cp "${certPath}" /usr/local/share/ca-certificates/vite-plugin-trusted-https.crt\nsudo update-ca-certificates`
      case `win32`:
        return `Please manually trust the certificate:\n1. Right-click certificate file\n2. Select "Install Certificate..."\n3. Choose "Local Machine"\n4. Select "Place all certificates in the following store"\n5. Browse and select "Trusted Root Certification Authorities"`
      default:
        return `Please manually trust the certificate at: ${certPath}`
    }
  }

  /**
   * Prompt user for y/N input
   */
  async promptUser(question: string): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise((resolve) => {
      rl.question(`${question} (Y/n): `, (answer) => {
        rl.close()

        const response = answer.toLowerCase().trim()

        resolve(!response.toLowerCase().startsWith(`n`))
      })
    })
  }
}
