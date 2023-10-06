import fs from 'fs'
import path from 'path'
import * as url from 'url'

// Read JSON data from file
const dirname = url.fileURLToPath(new URL('.', import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.resolve(dirname, 'data')
const data = fs.readFileSync(path.join(DATA_DIR, 'raw_data.json'), 'utf8')
const jsonData = JSON.parse(data)

// Extract the issue objects
const issueObjects = {}

function extractIssues(arr) {
  for (const item of arr) {
    if (Array.isArray(item)) {
      extractIssues(item)
    } else if (typeof item === 'object') {
      if ('id' in item && 'title' in item) {
        issueObjects[item.id] = {
          id: item.id,
          title: item.title,
          description: '',
          priority: item.priority.toLowerCase(),
          status: item.status.toLowerCase(),
          modified: new Date(item.modified).toISOString(),
          created: new Date(item.created).toISOString(),
          kanbanorder: item.kanbanOrder,
          username: item.creator,
          comments: [],
        }
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
        const comment = {
          id: item.id,
          body: item.body,
          username: item.creator,
          issue_id: item.issueID,
          created_at: new Date(item.created).toISOString(),
        }
        commentObjects.push(comment)
        issueObjects[item.issueID].comments.push(comment)
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

const issueList = Object.values(issueObjects).sort(
  (a, b) => new Date(a.created) - new Date(b.created)
)
const commentList = commentObjects.sort(
  (a, b) => new Date(a.created_at) - new Date(b.created_at)
)

console.log(`Issues: ${issueList.length}`)
console.log(`Comments: ${commentList.length}`)

// Output the data
fs.writeFileSync(
  path.join(DATA_DIR, 'issues.json'),
  JSON.stringify(issueList, null, 2)
)
