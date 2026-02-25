---
name: subset-params-reference
parent: electric-http-api
---

# Subset Snapshot Parameters Reference

Subset snapshots let you fetch specific data portions in changes-only mode.

## Query Parameters (GET)

| Parameter          | Type          | Description                                        |
| ------------------ | ------------- | -------------------------------------------------- |
| `subset__where`    | `string`      | SQL WHERE filter for subset                        |
| `subset__params`   | `JSON object` | Positional parameters for WHERE (`{"1": "value"}`) |
| `subset__limit`    | `number`      | Maximum rows to return                             |
| `subset__order_by` | `string`      | Column to order results by                         |

## POST Body (recommended for large queries)

```json
{
  "where": "id = ANY($1)",
  "params": { "1": "{id1,id2,id3}" },
  "order_by": "created_at",
  "limit": 100
}
```

## TypeScript Client

```typescript
// Set POST as default for all subset requests
const stream = new ShapeStream({
  url: `/api/items`,
  log: 'changes_only',
  subsetMethod: 'POST',
})

// Request a snapshot
const { metadata, data } = await stream.requestSnapshot({
  where: 'priority = $1',
  params: { '1': 'high' },
  limit: 50,
})

// Override method per-request
const { data } = await stream.requestSnapshot({
  where: 'id = ANY($1)',
  params: { '1': '{id1,id2,...}' },
  method: 'POST',
})
```

## Response

Subset snapshot responses include metadata for change deduplication:

```json
{
  "metadata": {
    "snapshotOffset": "123_4",
    "snapshotHandle": "abc"
  },
  "data": [{ "key": "1", "value": { "id": "1", "priority": "high" } }]
}
```

## Interaction with Changes-Only Mode

Subset snapshots only work with `log: "changes_only"`. The workflow is:

1. Subscribe to changes-only stream for real-time updates
2. Request subset snapshots as needed for specific data
3. Use snapshot metadata to deduplicate with incoming changes
