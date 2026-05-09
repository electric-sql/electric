Subject: `[agent:{role}] {short subject}`

Body must include the correlation id of what's being addressed:

```
[agent:reviewer] address must-fix in src/parse.ts:42

Resolves agent-thread-id: t_abc123
```

For build-doctor: `Resolves check: <check name>`.
For doc-editor: `Resolves doc_plan: <doc_path>`.
