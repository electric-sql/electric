# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Electric, please report it through
[GitHub's private vulnerability reporting](https://github.com/electric-sql/electric/security/advisories/new).

**Do not open a public issue for security vulnerabilities.**

### What to include

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof of concept
- The affected version(s) or commit(s)
- Any suggested fix, if you have one

### Response timeline

- **Acknowledgement**: within 24 hours of your report
- **Initial assessment**: normally within 48 hours, we will confirm whether the report is accepted and share our initial severity assessment
- **Resolution**: we aim to fix critical issues the same day, though timelines vary based on complexity. Resolution includes an OSS release and deploying the fix to Electric Cloud

### Disclosure policy

We follow a **coordinated disclosure** process with a **30-day embargo**:

1. You report the vulnerability privately via GitHub
2. We acknowledge and work on a fix
3. We release the fix and publish a security advisory
4. After the fix is released — or after 30 days, whichever comes first — you are free to publish details about the vulnerability

We ask that you do not disclose the vulnerability publicly until the embargo period has passed or we have published a fix, whichever comes first.

## Supported Versions

Security fixes are applied to the latest release. We do not backport fixes to older major or minor versions unless the severity warrants it.

## Scope

The following are **in scope**:

- The Electric sync engine (`packages/sync-service`)
- Official client libraries (`packages/typescript-client`, `packages/elixir-client`, `packages/react-hooks`)
- [Electric Cloud](https://dashboard.electric-sql.cloud/)
- [Phoenix Sync](https://github.com/electric-sql/phoenix_sync)

The following are **out of scope**:

- Experimental features (e.g. the `@electric-sql/experimental` package, or features behind feature flags)
- Example applications in the `examples/` directory
- Third-party dependencies (please report these to the upstream project)
- Social engineering or phishing attacks against Electric team members

## Recognition

We appreciate the work of security researchers. With your permission, we will credit you in the security advisory for any confirmed vulnerability you report.
