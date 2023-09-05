const fs = require('fs')

// Read JSON data from file
const data = fs.readFileSync('data.json')
const jsonData = JSON.parse(data)

// Extract the issue objects
const issueObjects = {}

function extractIssues(arr) {
  for (const item of arr) {
    if (Array.isArray(item)) {
      extractIssues(item)
    } else if (typeof item === 'object') {
      if ('id' in item && 'title' in item) {
        issueObjects[item.id] = item
      }
    }
  }
}

extractIssues(jsonData.chunks)

// Extract the comment objects
const commentObjects = []

function extractComments(arr) {
  for (const item of arr) {
    if (Array.isArray(item)) {
      extractComments(item)
    } else if (typeof item === 'object') {
      if (
        'id' in item &&
        'issueID' in item &&
        'created' in item &&
        'body' in item &&
        'creator' in item
      ) {
        commentObjects.push(item)
      }
    }
  }
}

extractComments(jsonData.chunks)

// Extract the description objects
const descriptionObjects = []

function extractDescriptions(arr) {
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]
    if (Array.isArray(item)) {
      extractDescriptions(item)
    } else {
      if (typeof item === 'string') {
        if (item.startsWith('description')) {
          const issueId = item.split('/')[1]
          if (issueObjects[issueId]) {
            issueObjects[issueId].description = arr[++i]
          } else {
            console.log(`${issueId} is not an issue`)
          }
        }
      }
      if (typeof item === 'object') {
        if ('id' in item && 'description' in item) {
          descriptionObjects.push(item)
        }
      }
    }
  }
}

extractDescriptions(jsonData.chunks)

// Generate SQL statements for issues
const insertIssueSqlStatements = []
/*for (const issue of Object.values(issueObjects)) {
  const values = [
    issue.id,
    issue.title,
    issue.priority,
    issue.status,
    issue.modified,
    issue.created,
    issue.creator,
    issue.kanbanOrder,
    issue.description
  ];
  const insertStatement = `INSERT INTO issue (id, title, priority, status, modified, created, creator, kanbanOrder, description) VALUES ('${values.join("', '")}');`;
  insertIssueSqlStatements.push(insertStatement);
}*/

// Generate SQL statements for comments
const insertCommentSqlStatements = []
for (const comment of commentObjects) {
  const values = [
    comment.id,
    comment.issueID,
    comment.created,
    comment.body.replace(/'/g, "''"),
    comment.creator,
  ]
  const insertStatement = `INSERT INTO comments (id, issueID, created, body, creator) VALUES ('${values.join(
    "', '"
  )}');`
  insertCommentSqlStatements.push(insertStatement)
}

// Generate SQL statements for descriptions
const insertDescriptionSqlStatements = []
for (const description of descriptionObjects) {
  const values = [description.id, description.description.replace(/'/g, "''")]
  const insertStatement = `INSERT INTO descriptions (id, description) VALUES ('${values.join(
    "', '"
  )}');`
  insertDescriptionSqlStatements.push(insertStatement)
}

// Output the SQL statements to separate files
fs.writeFileSync('issues.json', JSON.stringify(issueObjects))
//fs.writeFileSync('comments.json', insertCommentSqlStatements.join('\n'));
