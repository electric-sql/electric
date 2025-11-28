import { readFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'

/**
 * This script comments on PRs and their linked issues when included in a release.
 * It reads the published packages from the PUBLISHED_PACKAGES environment variable,
 * extracts commit hashes from their changelogs, maps them to PRs, finds linked issues,
 * and posts comments on both.
 */

const REPO = process.env.GITHUB_REPOSITORY || 'electric-sql/electric'

async function main() {
  const publishedPackages = JSON.parse(
    process.env.PUBLISHED_PACKAGES || '[]'
  )

  if (publishedPackages.length === 0) {
    console.log('No published packages found')
    return
  }

  console.log('Published packages:', publishedPackages)

  // Map to collect PRs and their associated packages
  const prToPackages = new Map()

  for (const pkg of publishedPackages) {
    const { name, version } = pkg
    console.log(`\nProcessing ${name}@${version}`)

    // Find the changelog file for this package
    const changelogPath = findChangelogPath(name)
    if (!changelogPath) {
      console.log(`  No changelog found for ${name}`)
      continue
    }

    // Extract commit hashes from the changelog for this version
    const commits = extractCommitsFromChangelog(changelogPath, version)
    console.log(`  Found ${commits.length} commits in changelog`)

    // For each commit, find the associated PR
    for (const commit of commits) {
      const prNumber = await findPRForCommit(commit)
      if (prNumber) {
        if (!prToPackages.has(prNumber)) {
          prToPackages.set(prNumber, [])
        }
        prToPackages.get(prNumber).push({ name, version })
      }
    }
  }

  console.log(`\nFound ${prToPackages.size} PRs to comment on`)

  // Collect issues linked to PRs
  const issueToPackages = new Map()

  // Comment on each PR and collect linked issues
  for (const [prNumber, packages] of prToPackages) {
    await commentOnPR(prNumber, packages)

    // Find issues that this PR closes/fixes
    const linkedIssues = await findLinkedIssues(prNumber)
    for (const issueNumber of linkedIssues) {
      if (!issueToPackages.has(issueNumber)) {
        issueToPackages.set(issueNumber, [])
      }
      // Merge packages, avoiding duplicates
      for (const pkg of packages) {
        const existing = issueToPackages.get(issueNumber)
        if (!existing.some((p) => p.name === pkg.name && p.version === pkg.version)) {
          existing.push(pkg)
        }
      }
    }
  }

  console.log(`\nFound ${issueToPackages.size} linked issues to comment on`)

  // Comment on each linked issue
  for (const [issueNumber, packages] of issueToPackages) {
    await commentOnIssue(issueNumber, packages)
  }
}

function findChangelogPath(packageName) {
  // Map package names to their directories
  const packageDirs = [
    'packages/typescript-client',
    'packages/react-hooks',
    'packages/experimental',
    'packages/sync-service',
    'packages/elixir-client',
    'packages/y-electric',
  ]

  for (const dir of packageDirs) {
    const pkgJsonPath = `${dir}/package.json`
    if (existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
        if (pkgJson.name === packageName) {
          const changelogPath = `${dir}/CHANGELOG.md`
          if (existsSync(changelogPath)) {
            return changelogPath
          }
        }
      } catch (e) {
        // Skip if package.json is invalid
      }
    }
  }

  return null
}

function extractCommitsFromChangelog(changelogPath, version) {
  const changelog = readFileSync(changelogPath, 'utf8')
  const commits = []

  // Find the section for this version
  // Format: ## X.Y.Z
  const versionHeader = `## ${version}`
  const versionIndex = changelog.indexOf(versionHeader)

  if (versionIndex === -1) {
    console.log(`  Version ${version} not found in changelog`)
    return commits
  }

  // Find the next version header to delimit the section
  const nextVersionMatch = changelog
    .slice(versionIndex + versionHeader.length)
    .match(/\n## \d+\.\d+\.\d+/)
  const sectionEnd = nextVersionMatch
    ? versionIndex + versionHeader.length + nextVersionMatch.index
    : changelog.length

  const versionSection = changelog.slice(versionIndex, sectionEnd)

  // Extract commit hashes (7-character hex at the start of lines)
  // Format: "- abc1234: description"
  const commitRegex = /^- ([a-f0-9]{7}):/gm
  let match
  while ((match = commitRegex.exec(versionSection)) !== null) {
    commits.push(match[1])
  }

  return commits
}

async function findPRForCommit(commitHash) {
  try {
    // Use gh CLI to find PR associated with commit
    const result = execSync(
      `gh api repos/${REPO}/commits/${commitHash}/pulls --jq '.[0].number'`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()

    if (result && result !== 'null') {
      console.log(`  Commit ${commitHash} -> PR #${result}`)
      return parseInt(result, 10)
    }
  } catch (e) {
    // Commit might not be associated with a PR (direct push)
    console.log(`  Commit ${commitHash} has no associated PR`)
  }
  return null
}

async function commentOnPR(prNumber, packages) {
  const packageList = packages
    .map((p) => `- \`${p.name}@${p.version}\``)
    .join('\n')

  const body = `This PR has been released! :rocket:

The following packages include changes from this PR:

${packageList}

Thanks for contributing to Electric!`

  try {
    // Check if we already commented on this PR
    const existingComments = execSync(
      `gh api repos/${REPO}/issues/${prNumber}/comments --jq '[.[] | select(.body | contains("This PR has been released!"))] | length'`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()

    if (parseInt(existingComments, 10) > 0) {
      console.log(`  Already commented on PR #${prNumber}, skipping`)
      return
    }

    execSync(
      `gh pr comment ${prNumber} --repo ${REPO} --body "${body.replace(/"/g, '\\"')}"`,
      { stdio: 'inherit' }
    )
    console.log(`  Commented on PR #${prNumber}`)
  } catch (e) {
    console.error(`  Failed to comment on PR #${prNumber}:`, e.message)
  }
}

async function findLinkedIssues(prNumber) {
  const [owner, repo] = REPO.split('/')
  const query = `
    query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          closingIssuesReferences(first: 10) {
            nodes {
              number
            }
          }
        }
      }
    }
  `

  try {
    const result = execSync(
      `gh api graphql -f query='${query}' -F owner='${owner}' -F repo='${repo}' -F pr=${prNumber} --jq '.data.repository.pullRequest.closingIssuesReferences.nodes[].number'`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()

    if (result) {
      const issues = result.split('\n').map((n) => parseInt(n, 10))
      console.log(`  PR #${prNumber} links to issues: ${issues.join(', ')}`)
      return issues
    }
  } catch (e) {
    // PR might not have any linked issues
    console.log(`  PR #${prNumber} has no linked issues`)
  }
  return []
}

async function commentOnIssue(issueNumber, packages) {
  const packageList = packages
    .map((p) => `- \`${p.name}@${p.version}\``)
    .join('\n')

  const body = `A fix for this issue has been released! :rocket:

The following packages include the fix:

${packageList}

Thanks for reporting!`

  try {
    // Check if we already commented on this issue
    const existingComments = execSync(
      `gh api repos/${REPO}/issues/${issueNumber}/comments --jq '[.[] | select(.body | contains("A fix for this issue has been released!"))] | length'`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()

    if (parseInt(existingComments, 10) > 0) {
      console.log(`  Already commented on issue #${issueNumber}, skipping`)
      return
    }

    execSync(
      `gh issue comment ${issueNumber} --repo ${REPO} --body "${body.replace(/"/g, '\\"')}"`,
      { stdio: 'inherit' }
    )
    console.log(`  Commented on issue #${issueNumber}`)
  } catch (e) {
    console.error(`  Failed to comment on issue #${issueNumber}:`, e.message)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
