---
"@electric-ax/agents-server": patch
"@electric-ax/agents-server-ui": patch
"@electric-ax/agents-desktop": patch
---

Expose tenant-scoped users as an Electric shape and add a chat sharing dialog that grants user principals view, chat, or manage permissions over an entity. View/chat sharing includes fork access, forked chats are owned by the principal that creates the fork, and Cloud requests now inject the signed-in user as the Electric principal.
