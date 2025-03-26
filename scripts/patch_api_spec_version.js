#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

const packageVersionPlaceholders = {
  'sync-service': '__PLACEHOLDER_SYNC_SERVICE_VERSION__'
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

function main() {
  // Get the file path from command line arguments
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Error: Please provide a file path');

    process.exit(1);
  }

  try {
    // Read the file
    const content = fs.readFileSync(filePath, 'utf8');

    // Replace placeholders
    const updatedContent = replaceVersionPlaceholders(content);

    // Write the updated content back to the file
    fs.writeFileSync(filePath, updatedContent);

    console.log(`Successfully updated version placeholders in ${filePath}`);
  } catch (error) {
    console.error(`Error processing file: ${error.message}`);
    process.exit(1);
  }
}

// Execute the main function
main();