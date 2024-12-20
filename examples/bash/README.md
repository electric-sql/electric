# Electric Bash Client

A simple bash client for consuming Electric shape logs. This client can connect to any Electric shape URL and stream updates in real-time.

## Requirements

- bash
- curl
- jq (for JSON processing)

## Usage

```bash
./client.bash 'YOUR_SHAPE_URL'
```

For example:
```bash
./client.bash 'http://localhost:3000/v1/shape?table=notes'
```

## Example Output

When first connecting, you'll see the initial shape data:
```json
[
  {
    "key": "\"public\".\"notes\"/\"1\"",
    "value": {
      "id": "1",
      "title": "Example Note",
      "created_at": "2024-12-05 01:43:05.219957+00"
    },
    "headers": {
      "operation": "insert",
      "relation": [
        "public",
        "notes"
      ]
    },
    "offset": "0_0"
  }
]
```

Once caught up, the client switches to live mode and streams updates:
```
Found control message
Control value: up-to-date
Shape is up to date, switching to live mode
```

Any changes to the shape will be streamed in real-time.
