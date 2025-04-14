// scripts/llms.js
const fs = require('fs');
const path = require('path');

// Set up the paths based on repo structure
const REPO_ROOT = path.resolve(__dirname, '..');
const WEBSITE_DIR = path.join(REPO_ROOT, 'website');
const SOURCE_FILE = path.join(WEBSITE_DIR, 'llms.txt.template');

// Default output directory (can be overridden by command line argument)
let OUTPUT_DIR = path.join(WEBSITE_DIR, '.vitepress/dist');

// Parse command line arguments
if (process.argv.length > 2) {
  OUTPUT_DIR = path.resolve(process.argv[2]);
}

const OUTPUT_FILE = path.join(OUTPUT_DIR, 'llms.txt');

// Regular expression patterns
const INCLUDE_PATTERN = /<<<\s*@([^\s{]+)(?:\{(\w+)\})?/g;
const FRONTMATTER_PATTERN = /^---\s*[\s\S]*?---\s*/m;
const VUE_SCRIPT_SETUP_PATTERN = /<script\s+setup\s*>[\s\S]*?<\/script\s*>/gi;
const HTML_IMG_TAG_PATTERN = /<img[^>]*>/gi;
const HTML_FIGURE_PATTERN = /<figure\b[^>]*>[\s\S]*?<\/figure\s*>/gi;

const packageVersionPlaceholders = {
  'sync-service': '__PLACEHOLDER_SYNC_SERVICE_VERSION__',
  'react-hooks': '__PLACEHOLDER_REACT_HOOKS_VERSION__',
  'typescript-client': '__PLACEHOLDER_TYPESCRIPT_CLIENT_VERSION__'
};

const truncationPoints = {
  'auth.md': '### Gatekeeper auth',
  'client-development.md': '## Examples',
  'http.md': '## Syncing shapes',
  'installation.md': '## Advanced',
  'phoenix.md': '### Local HTTP services',
  'security.md': '## Encryption',
  'shapes.md': '## Throughput',
  'writes.md': '> [!Warning] Write-patterns example on GitHub'
};

function getPackageVersion(packageName) {
  const packagePath = path.join(REPO_ROOT, 'packages', packageName, 'package.json');

  return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
}

function replaceVersionPlaceholders(content) {
  let updatedContent = content;

  for (const [packageName, placeholder] of Object.entries(packageVersionPlaceholders)) {
    const version = getPackageVersion(packageName);

    updatedContent = updatedContent.replace(new RegExp(placeholder, 'g'), version);
  }

  return updatedContent;
}

// Function to resolve file path
function resolvePath(basePath, includePath) {
  if (includePath.startsWith('../../examples/') || includePath.startsWith('../../packages/')) {
    return path.join(REPO_ROOT, includePath.replace('../../', ''));
  } else if (includePath.startsWith('/')) {
    return path.join(WEBSITE_DIR, includePath.substring(1));
  } else if (includePath.startsWith('./') || includePath.startsWith('../')) {
    return path.resolve(path.dirname(basePath), includePath);
  }
  return path.join(WEBSITE_DIR, includePath);
}

// Function to determine if a file is a markdown file
function isMarkdownFile(filePath) {
  return filePath.toLowerCase().endsWith('.md') || filePath.toLowerCase().endsWith('.markdown');
}

// Function to get the language from a file extension
function getLanguageFromPath(filePath, explicitLanguage = null) {
  if (explicitLanguage) {
    return explicitLanguage;
  }

  const ext = path.extname(filePath).toLowerCase().substring(1);
  const languageMap = {
    'css': 'css',
    'ex': 'elixir',
    'exs': 'elixir',
    'html': 'html',
    'js': 'javascript',
    'jsx': 'jsx',
    'nginx': 'nginx',
    'sql': 'sql',
    'tsx': 'tsx',
    'ts': 'typescript',
  };

  return languageMap[ext] || ext;
}

// Function to clean HTML from content
function cleanHtml(html) {
  // Handle div and span tags
  html = html.replace(/<(div|span)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner) => {
    return cleanHtml(inner.trim());
  });

  // Remove figure, img tags, HTML comments and special characters
  html = html.replace(HTML_FIGURE_PATTERN, '')
    .replace(HTML_IMG_TAG_PATTERN, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/&nbsp;/g, ' ');

  // Remove other HTML tags but preserve content
  html = html.replace(/<(?!pre|\/pre)(?!h[1-6]|\/h[1-6])(?!p|\/p)(?!ul|\/ul)(?!ol|\/ol)(?!li|\/li)(?!table|\/table)(?!tr|\/tr)(?!td|\/td)(?!th|\/th)(?!thead|\/thead)(?!tbody|\/tbody)(?!blockquote|\/blockquote)(?!strong|\/strong)(?!em|\/em)(?!del|\/del)[a-zA-Z][^>]*>/g, '');
  html = html.replace(/<\/[a-zA-Z][^>]*>/g, '');

  return html;
}

// Function to clean markdown content
function cleanMarkdownContent(content) {
  // Remove Vue script setup tags and stray code tags
  content = content.replace(VUE_SCRIPT_SETUP_PATTERN, '').replace(/<\/?code>/g, '');

  // Extract code blocks
  const codeBlocks = [];
  content = content.replace(/```[^\n]*\n[\s\S]*?```/g, match => {
    codeBlocks.push(match);
    return `CODE_BLOCK_${codeBlocks.length - 1}`;
  });

  // Clean non-code content
  content = cleanHtml(content)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();

  // Restore code blocks
  content = content.replace(/CODE_BLOCK_(\d+)/g, (_, index) => codeBlocks[parseInt(index)]);

  return content;
}

// Function to fix code block formatting - with properly escaped backticks
function fixCodeBlockFormatting(content) {
  // Fix code blocks - ensure no empty line before closing delimiter
  content = content.replace(
    /(```[^\n]*\n)([\s\S]*?)(\n*)```/g,
    function(match, start, code, trailing) {
      const trimmedCode = code.replace(/\s+$/g, '');
      return start + trimmedCode + '\n```';
    }
  );

  // Process the content with multiple individual replacements to avoid syntax errors
  content = content.replace(/\r\n/g, '\n');
  content = content.replace(/([^\n])\n```/g, '$1\n\n```');
  content = content.replace(/\n\n\n+```/g, '\n\n```');
  content = content.replace(/(^|\n)(#{1,6}[^\n]+)(\n)```/g, '$1$2\n\n```');
  content = content.replace(/```\n\n+/g, '```\n\n');
  content = content.replace(/\n{3,}/g, '\n\n');
  content = content.replace(/\n\n```\n\n/g, '\n```\n\n');

  return content;
}

// Function to safely check if a path is a file
function isFile(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch (e) {
    return false;
  }
}

function truncateContent(filePath, content) {
  // Extract just the filename from the path
  const fileName = filePath.split('/').pop();

  // Check if we have a truncation point for this file
  if (truncationPoints[fileName]) {
    const splitText = truncationPoints[fileName];

    // Verify the split text exists in the content
    if (!content.includes(splitText)) {
      console.error(
        `
Error: Split text "${splitText}" not found in ${fileName}

Has the included content changed in a way that breaks the \`truncationPoints\` mapping?
Maybe you need to truncate a doc file using a different match string?

        `.trim()
      );

      process.exit(1);
    }

    // Perform the truncation
    return content.split(splitText)[0].trim();
  }

  // If no truncation defined for this file, return the original content
  return content;
}

// Function to process a file and expand includes
function processFile(filePath, visitedPaths = new Set()) {
  // Check for circular includes or non-existent files
  if (visitedPaths.has(filePath)) {
    throw new Error(`Circular include detected for ${filePath}`);
  }
  if (!isFile(filePath)) {
    throw new Error(`Not a file or file doesn't exist: ${filePath}`);
  }

  // Add current path to visited paths
  visitedPaths.add(filePath);

  // Read the file
  let content = fs.readFileSync(filePath, 'utf-8');

  // Drop the front matter.
  if (filePath.endsWith('.md') && content.startsWith('---')) {
    content = content.split('---').slice(2).join('---').trim()
  }

  // Truncate based on filename.
  content = truncateContent(filePath, content);

  // Special handling for http.md - inject the API spec
  if (filePath.endsWith('http.md')) {
    const apiSpecPath = resolvePath(filePath, 'electric-api.yaml');
    const apiSpecContent = fs.readFileSync(apiSpecPath, 'utf-8');
    content = content.replace(/(## HTTP API specification\s*)([\s\S]*?)(?=\s*##)/,
      (match, header) => `${header}\n\n\`\`\`yaml\n${apiSpecContent}\n\`\`\`\n\n`);
  }

  // Process includes recursively
  content = content.replace(INCLUDE_PATTERN, (fullMatch, includePath, languageSpec) => {
    const includedFilePath = resolvePath(filePath, includePath);

    if (!isFile(includedFilePath)) {
      throw new Error(`Include file not found or is a directory: ${includePath} (referenced from ${filePath})`);
    }

    // Process included file
    let includedContent = processFile(includedFilePath, new Set([filePath]));

    // If it's a markdown file, include directly
    if (isMarkdownFile(includedFilePath)) {
      return `\n\n${includedContent}\n\n`;
    } else {
      // For code files, wrap in code blocks with language
      const language = getLanguageFromPath(includedFilePath, languageSpec);

      // Get indentation from the original include statement
      const indent = (fullMatch.match(/^([ \t]*)/m) || ['', ''])[1];

      // Apply indentation to each line and ensure no trailing empty line
      const indentedContent = includedContent
        .split('\n')
        .map(line => line.length > 0 ? indent + line : line)
        .join('\n')
        .trimRight();

      return `\n\n\`\`\`${language}\n${indentedContent}\r\`\`\`\n\n`;
    }
  });

  // Clean markdown content after processing includes
  if (isMarkdownFile(filePath)) {
    content = cleanMarkdownContent(content);
  }

  return content;
}

// Function to ensure directory exists
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function removeUnnecessaryTokens(content) {
  // Create a copy of the content to avoid modifying the original
  let cleanedContent = content;

  // 1. Warning/Tip Blocks: Find and replace all warning/tip formatting
  cleanedContent = cleanedContent.replace(/> \[!Warning\].*?\n/g, '[WARNING] ');
  cleanedContent = cleanedContent.replace(/> \[!Tip\].*?\n/g, '[TIP] ');
  cleanedContent = cleanedContent.replace(/> \[!.*?\]\n/g, '');

  // 3. Comment Markers: Remove comment markers
  cleanedContent = cleanedContent.replace(/<!--.*?-->/gs, '');

  // 4. Horizontal Rules: Remove horizontal rule markers
  cleanedContent = cleanedContent.replace(/---+/g, '');

  // 6. Emoji and Decorative Characters: Remove emoji and decorative characters
  cleanedContent = cleanedContent.replace(/&mdash;/g, '-');
  cleanedContent = cleanedContent.replace(/&dash;/g, '-');
  cleanedContent = cleanedContent.replace(/&hellip;/g, '-');
  cleanedContent = cleanedContent.replace(/&ZeroWidthSpace;/g, '');
  // Add more emoji patterns if needed
  cleanedContent = cleanedContent.replace(/[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}]/gu, '');

  // 7. Repeated Phrase Patterns
  cleanedContent = cleanedContent.replace(/This is what both the.+?\./gs, '');
  cleanedContent = cleanedContent.replace(/For more information see.+?\./g, '');
  cleanedContent = cleanedContent.replace(/This allows you to.+?\./g, '');

  // 8. Template Language Markers: Remove template language markers
  cleanedContent = cleanedContent.replace(/:::tabs[\s\S]*?:::/g, '');
  cleanedContent = cleanedContent.replace(/==.*?==/g, '');

  // 10. Redundant Phrases
  const redundantPhrases = [
    'For example',
    'Note that',
    'As you can see',
    'In this way',
    'It\'s worth noting that',
    'Please note',
    'Keep in mind',
    'As mentioned earlier',
    'In other words',
    'To be specific',
    'In particular',
    'To put it simply',
    'In essence',
    'To summarize'
  ];

  redundantPhrases.forEach(phrase => {
    cleanedContent = cleanedContent.replace(new RegExp(phrase + '[,:]?\\s+', 'gi'), '');
  });

  // Clean up any resulting double spaces or extra newlines
  cleanedContent = cleanedContent.replace(/\s+\n/g, '\n');
  cleanedContent = cleanedContent.replace(/\n{3,}/g, '\n\n');

  return cleanedContent;
}

// Main function
function main() {
  console.log(`Starting LLMs content generation...`);

  // Check if the source file exists
  if (!isFile(SOURCE_FILE)) {
    throw new Error(`Source file not found: ${SOURCE_FILE}`);
  }

  // Read source file and remove frontmatter
  let content = fs.readFileSync(SOURCE_FILE, 'utf-8');
  content = content.replace(FRONTMATTER_PATTERN, '');

  const pgliteSyncPath = resolvePath(WEBSITE_DIR, 'src/partials/sync-into-pglite.tsx');
  const pgliteSyncContent = fs.readFileSync(pgliteSyncPath, 'utf-8').trim();

  // Create temporary file
  const tempFilePath = path.join(WEBSITE_DIR, '.temp-llms-content.md');
  fs.writeFileSync(tempFilePath, content);

  try {
    // Process file and apply final formatting
    let processedContent = processFile(tempFilePath);
    processedContent = fixCodeBlockFormatting(processedContent);
    processedContent += `\n\n\`\`\`tsx\n${pgliteSyncContent}\n\`\`\`\n`;
    processedContent = replaceVersionPlaceholders(processedContent);
    processedContent = removeUnnecessaryTokens(processedContent);

    // Ensure output directory exists and write result
    ensureDirectoryExists(OUTPUT_DIR);
    fs.writeFileSync(OUTPUT_FILE, processedContent);

    console.log(`Successfully generated: ${path.relative(process.cwd(), OUTPUT_FILE)}`);
  } finally {
    // Clean up temp file
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

// Run script
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

module.exports = { main };