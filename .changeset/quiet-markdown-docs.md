---
"@electric-ax/agents": patch
"@electric-ax/agents-runtime": patch
"@electric-ax/agents-server": patch
"@electric-ax/agents-server-ui": patch
---

Add collaborative markdown document tools backed by Yjs durable streams.

Horton can create, read, replace, edit, and stream inserts into markdown documents by mutating a wake-local Y.Doc and appending binary Yjs updates to the document stream. The server now keeps markdown document handling thin by creating document streams and serving manifest metadata while document content changes flow through the Yjs stream.
