# Electric Metadata API for Nginx Disk Serving

## Overview

To enable efficient disk-based serving of Shape data through nginx, Electric needs to provide a metadata endpoint that maps Shape offsets to byte positions in disk files. This allows nginx to serve specific portions of shape data without loading entire files into memory.

## Endpoint Specification

### `GET /v1/shape/metadata`

Returns metadata about where specific shape data is stored on disk.

**Purpose**: Allow nginx (or other caching layers) to serve shape data directly from disk by knowing exactly which bytes to read.

## Request Parameters

All the standard shape query parameters:

- `table` (required) - Table name
- `offset` (required) - Shape offset (format: `{tx_offset}_{op_offset}`)
- `handle` (required) - Shape handle
- `where` (optional) - WHERE clause
- `columns` (optional) - Column list
- Other shape definition parameters

## Response Format

### Success Response (200 OK)

```json
{
  "file": "snapshot_0.json",
  "file_path": "default/3833821-1721812114261/snapshot_0.json",
  "start_byte": 0,
  "end_byte": 2048,
  "next_offset": "1002_0",
  "has_more": false,
  "format": "json",
  "chunk_info": {
    "chunk_index": 0,
    "total_chunks": 1,
    "chunk_size": 2048
  }
}
```

### Response Headers

The endpoint should also return custom headers that nginx can use:

```
X-Electric-Chunk-File: snapshot_0.json
X-Electric-File-Path: default/3833821-1721812114261/snapshot_0.json
X-Electric-Start-Byte: 0
X-Electric-End-Byte: 2048
X-Electric-Next-Offset: 1002_0
X-Electric-Has-More: false
electric-handle: 3833821-1721812114261
electric-offset: 1002_0
```

### Error Responses

**404 Not Found** - Shape or offset not found:
```json
{
  "error": "not_found",
  "message": "Shape or offset not found"
}
```

**400 Bad Request** - Invalid parameters:
```json
{
  "error": "invalid_parameters",
  "message": "Invalid offset format",
  "details": "Offset must be in format {tx_offset}_{op_offset}"
}
```

**410 Gone** - Shape has been deleted:
```json
{
  "error": "shape_deleted",
  "message": "Shape has been deleted",
  "control": "must-refetch"
}
```

## Implementation Details

### Offset-to-Byte Mapping

Electric's `PureFileStorage` module already tracks offset-to-byte mappings in chunk indexes. The metadata endpoint should:

1. Parse the requested offset (`tx_offset`, `op_offset`)
2. Look up the chunk index to find which chunk contains this offset
3. Calculate the byte position within that chunk
4. Return the file path and byte range

### Chunk Index Format

The existing chunk index binary format stores:
```elixir
<<
  min_tx_offset::64,
  min_op_offset::64,
  start_pos::64,
  key_start_pos::64,
  max_tx_offset::64,
  max_op_offset::64,
  end_pos::64,
  key_end_pos::64
>>
```

The metadata endpoint should read this index and compute:
- Which chunk contains the requested offset
- The byte offset within that chunk
- How many bytes to read (until next logical boundary or end of chunk)

### File Format Considerations

#### JSON Snapshot Files

For JSON snapshot files (comma-separated JSON entries):
- Each entry is a complete JSON object
- Entries are separated by commas and newlines
- File ends with `0x04` (EOT) byte
- Byte ranges should align with complete JSON objects

#### Binary Log Files

For binary log files:
- Each entry has a fixed header with sizes
- Format: `<<tx_offset::64, op_offset::64, key_size::32, key::binary, op_type::8, flag::8, json_size::64, json::binary>>`
- Byte ranges can be computed precisely from the index
- Entries must not be split across byte ranges

### Handling Large Responses

For requests that would return large amounts of data:

1. **Pagination Support**: Return byte ranges that align with reasonable chunk sizes (e.g., 1MB)
2. **Set `has_more: true`**: Indicate more data is available
3. **Provide `next_offset`**: Tell the client which offset to request next
4. **Support byte-range requests**: Allow nginx to request specific byte ranges

## Usage Examples

### Example 1: Initial Sync

**Request**:
```
GET /v1/shape/metadata?table=users&offset=-1&handle=3833821-1721812114261
```

**Response**:
```json
{
  "file": "snapshot_0.json",
  "file_path": "default/3833821-1721812114261/snapshot_0.json",
  "start_byte": 0,
  "end_byte": 2048,
  "next_offset": "1002_3",
  "has_more": false,
  "format": "json"
}
```

**Nginx Action**: Serves bytes 0-2048 from `snapshot_0.json`

### Example 2: Pagination

**Request**:
```
GET /v1/shape/metadata?table=users&offset=1002_3&handle=3833821-1721812114261
```

**Response**:
```json
{
  "file": "snapshot_0.json",
  "file_path": "default/3833821-1721812114261/snapshot_0.json",
  "start_byte": 2048,
  "end_byte": 4096,
  "next_offset": "1005_1",
  "has_more": false,
  "format": "json"
}
```

**Nginx Action**: Serves bytes 2048-4096 from `snapshot_0.json`

### Example 3: Changes-Only Mode

**Request**:
```
GET /v1/shape/metadata?table=users&offset=1010_0&handle=3833821-1721812114261
```

**Response**:
```json
{
  "file": "log",
  "file_path": "default/3833821-1721812114261/log",
  "start_byte": 8192,
  "end_byte": 8256,
  "next_offset": "1011_0",
  "has_more": false,
  "format": "binary"
}
```

**Nginx Action**: Serves bytes 8192-8256 from the binary log file

## Integration with Nginx

### nginx.conf Configuration

```nginx
# Query Electric for metadata
location /internal/electric/metadata {
    internal;
    proxy_pass http://electric_service/v1/shape/metadata$is_args$args;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_pass_request_body off;
}

# Serve from disk using metadata
location /internal/shape/with_metadata {
    internal;

    # Get metadata from Electric
    auth_request /internal/electric/metadata;

    # Extract metadata from headers
    auth_request_set $file_path $upstream_http_x_electric_file_path;
    auth_request_set $start_byte $upstream_http_x_electric_start_byte;
    auth_request_set $end_byte $upstream_http_x_electric_end_byte;

    # Serve the byte range from disk
    # Note: This requires nginx Lua or a custom module for byte-range extraction
    alias /var/lib/electric/shapes/$file_path;
}
```

### With Nginx Lua (OpenResty)

For full byte-range serving support:

```lua
location /internal/shape/with_metadata {
    internal;

    content_by_lua_block {
        -- Query Electric for metadata
        local res = ngx.location.capture("/internal/electric/metadata", {
            args = ngx.var.args
        })

        if res.status ~= 200 then
            ngx.status = res.status
            ngx.say(res.body)
            return
        end

        -- Parse metadata response
        local cjson = require "cjson"
        local metadata = cjson.decode(res.body)

        -- Open file and read byte range
        local file_path = "/var/lib/electric/shapes/" .. metadata.file_path
        local file = io.open(file_path, "rb")

        if not file then
            ngx.status = 404
            ngx.say('{"error": "File not found"}')
            return
        end

        -- Seek to start position
        file:seek("set", metadata.start_byte)

        -- Read the byte range
        local length = metadata.end_byte - metadata.start_byte
        local data = file:read(length)
        file:close()

        -- Set response headers
        ngx.header["Content-Type"] = "application/json"
        ngx.header["electric-handle"] = metadata.handle
        ngx.header["electric-offset"] = metadata.next_offset
        ngx.header["electric-up-to-date"] = not metadata.has_more
        ngx.header["Cache-Control"] = "public, max-age=3600"
        ngx.header["X-Served-By"] = "nginx-disk"

        -- Send response
        ngx.say(data)
    }
}
```

## Implementation in Electric

### Suggested Module Structure

```elixir
# lib/electric/plug/shape_metadata_plug.ex
defmodule Electric.Plug.ShapeMetadataPlug do
  @moduledoc """
  Provides metadata about shape storage locations and byte offsets.

  This endpoint allows caching layers (like nginx) to serve shape data
  directly from disk by providing file paths and byte ranges.
  """

  import Plug.Conn
  require Logger

  def call(conn, _opts) do
    with {:ok, params} <- parse_params(conn),
         {:ok, shape_handle} <- validate_handle(params),
         {:ok, offset} <- parse_offset(params.offset),
         {:ok, metadata} <- get_chunk_metadata(shape_handle, offset) do

      conn
      |> put_resp_header("x-electric-chunk-file", metadata.file)
      |> put_resp_header("x-electric-file-path", metadata.file_path)
      |> put_resp_header("x-electric-start-byte", to_string(metadata.start_byte))
      |> put_resp_header("x-electric-end-byte", to_string(metadata.end_byte))
      |> put_resp_header("x-electric-next-offset", metadata.next_offset)
      |> put_resp_header("x-electric-has-more", to_string(metadata.has_more))
      |> put_resp_header("electric-handle", shape_handle)
      |> send_json(conn, 200, metadata)
    else
      {:error, :not_found} ->
        send_json(conn, 404, %{error: "not_found", message: "Shape or offset not found"})

      {:error, :invalid_offset} ->
        send_json(conn, 400, %{error: "invalid_offset", message: "Invalid offset format"})

      {:error, reason} ->
        Logger.error("Metadata error: #{inspect(reason)}")
        send_json(conn, 500, %{error: "internal_error", message: "Failed to retrieve metadata"})
    end
  end

  defp get_chunk_metadata(shape_handle, {tx_offset, op_offset}) do
    # Query the chunk index to find byte positions
    # This would use Electric.ShapeCache.FileStorage functions

    with {:ok, chunk_index} <- read_chunk_index(shape_handle),
         {:ok, chunk_info} <- find_chunk_for_offset(chunk_index, tx_offset, op_offset),
         {:ok, byte_range} <- calculate_byte_range(chunk_info, tx_offset, op_offset) do

      {:ok, %{
        file: chunk_info.file_name,
        file_path: "#{chunk_info.stack_id}/#{shape_handle}/#{chunk_info.file_name}",
        start_byte: byte_range.start,
        end_byte: byte_range.end,
        next_offset: format_offset(byte_range.next_tx, byte_range.next_op),
        has_more: byte_range.has_more,
        format: chunk_info.format,
        chunk_info: %{
          chunk_index: chunk_info.index,
          total_chunks: chunk_info.total,
          chunk_size: byte_range.end - byte_range.start
        }
      }}
    end
  end
end
```

### Add Route

```elixir
# lib/electric/plug/router.ex
defmodule Electric.Plug.Router do
  use Plug.Router

  # ... existing routes ...

  # Metadata endpoint for nginx
  get "/v1/shape/metadata" do
    ShapeMetadataPlug.call(conn, [])
  end
end
```

## Benefits

1. **Reduced Load**: Electric only handles metadata queries, not full data serving
2. **CDN-Friendly**: Nginx/CDN can cache both metadata and data responses
3. **Efficient**: Only required bytes are read from disk
4. **Scalable**: Metadata queries are lightweight, data serving is distributed
5. **Flexible**: Supports both proxy and disk-serving modes

## Migration Path

### Phase 1: Proxy Only (Current)
- All requests go through Electric
- Nginx caches responses
- No metadata endpoint needed

### Phase 2: Metadata + Disk (Hybrid)
- Live requests: Proxy to Electric
- Initial requests: Proxy to Electric (populates cache)
- Subsequent requests: Query metadata, serve from disk
- Requires metadata endpoint

### Phase 3: Full Disk Serving (Advanced)
- All non-live requests served from disk
- Electric only handles:
  - Live mode long-polling
  - Metadata queries
  - Shape deletion
  - Initial snapshot creation

## Testing

### Test Cases

1. **Valid offset**: Should return correct byte range
2. **Invalid offset**: Should return 400
3. **Missing shape**: Should return 404
4. **Deleted shape**: Should return 410
5. **Boundary conditions**: First/last offsets
6. **Large shapes**: Pagination across multiple chunks
7. **Binary vs JSON**: Different file formats

### Example Test

```elixir
defmodule Electric.Plug.ShapeMetadataPlugTest do
  use ExUnit.Case, async: true

  test "returns byte range for valid offset" do
    conn = conn(:get, "/v1/shape/metadata", %{
      "table" => "users",
      "offset" => "1000_0",
      "handle" => "3833821-1721812114261"
    })

    conn = ShapeMetadataPlug.call(conn, [])

    assert conn.status == 200
    assert %{
      "file" => "snapshot_0.json",
      "start_byte" => start_byte,
      "end_byte" => end_byte
    } = Jason.decode!(conn.resp_body)

    assert is_integer(start_byte)
    assert is_integer(end_byte)
    assert end_byte > start_byte
  end
end
```

## Performance Considerations

1. **Metadata Caching**: Cache metadata responses for frequently accessed offsets
2. **Index Loading**: Keep chunk indexes in memory (ETS table)
3. **Batch Queries**: Support multiple offset queries in one request
4. **Connection Pooling**: Nginx should maintain persistent connections to Electric

## Security Considerations

1. **Path Traversal**: Validate file paths to prevent directory traversal
2. **Access Control**: Respect shape permissions and authentication
3. **Rate Limiting**: Apply rate limits to metadata endpoint
4. **Validation**: Strictly validate all offset and handle parameters
