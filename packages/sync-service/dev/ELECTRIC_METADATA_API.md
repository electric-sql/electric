# Electric Metadata API for Nginx Disk Serving

## Overview

To enable efficient disk-based serving of Shape data through nginx, Electric provides a metadata endpoint that determines whether a request can be served from disk or needs to be handled by Electric directly. This gives Electric full control over routing decisions.

## Endpoint Specification

### `GET /v1/shape/metadata`

Returns metadata about how a shape request should be handled.

**Purpose**: Electric decides for each request whether nginx can serve it from disk or if Electric needs to handle it. This allows Electric to control when disk serving is appropriate based on:
- Whether the shape exists and is ready
- Whether the requested offset is available on disk
- Whether the request needs special handling (initial sync, shape creation, etc.)
- System state and performance considerations

## Request Parameters

All the standard shape query parameters:

- `table` (required) - Table name
- `offset` (required) - Shape offset (format: `{tx_offset}_{op_offset}`)
- `handle` (required) - Shape handle
- `where` (optional) - WHERE clause
- `columns` (optional) - Column list
- Other shape definition parameters

## Response Format

Electric responds with one of two modes: **disk** or **proxy**.

### Response 1: Serve from Disk (200 OK)

When Electric determines nginx can serve from disk:

**Required Headers:**
```
X-Electric-Mode: disk
X-Electric-File-Path: default/3833821-1721812114261/snapshot_0.json
electric-handle: 3833821-1721812114261
electric-offset: 1002_0
```

**Optional Headers (for byte-range serving):**
```
X-Electric-Start-Byte: 0
X-Electric-End-Byte: 2048
```

**Optional JSON Body:**
```json
{
  "mode": "disk",
  "file_path": "default/3833821-1721812114261/snapshot_0.json",
  "start_byte": 0,
  "end_byte": 2048,
  "handle": "3833821-1721812114261",
  "offset": "1002_0"
}
```

**What nginx does:**
- Reads the file at `$shapes_root/$file_path`
- Serves it to the client with the specified Electric headers
- Caches the response for 1 hour

### Response 2: Proxy to Electric (200 OK)

When Electric needs to handle the request itself:

**Required Header:**
```
X-Electric-Mode: proxy
```

**Optional JSON Body:**
```json
{
  "mode": "proxy",
  "reason": "shape_not_ready"
}
```

**What nginx does:**
- Proxies the full client request to Electric's `/v1/shape` endpoint
- Electric handles the request completely
- Nginx caches the response

**Common reasons for proxy mode:**
- `shape_not_ready` - Shape doesn't exist yet, needs creation (offset=-1)
- `shape_building` - Shape is being rebuilt
- `offset_unavailable` - Requested offset not on disk yet
- `requires_computation` - Request needs dynamic computation
- `no_handle` - Client didn't provide a handle

### Response 3: Error Responses

When metadata cannot be determined, nginx will fallback to proxying.

**404 Not Found** - Nginx will fallback to proxy:
```
X-Electric-Mode: proxy
```
(or nginx auth_request error handling triggers fallback)

**500 Internal Server Error** - Nginx will fallback to proxy

**Note**: Error responses from the metadata endpoint trigger nginx's fallback mechanism, which proxies the request to Electric's main endpoint. This ensures requests always succeed even if the metadata service is unavailable.

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

### Example 1: Initial Sync (Proxy Mode)

**Client Request to Nginx**:
```
GET /v1/shape?table=users&offset=-1
```

**Nginx → Electric Metadata Request**:
```
GET /v1/shape/metadata?table=users&offset=-1
```

**Electric Response**:
```
HTTP/1.1 200 OK
X-Electric-Mode: proxy

{
  "mode": "proxy",
  "reason": "shape_not_ready"
}
```

**Nginx Action**:
- Sees `X-Electric-Mode: proxy`
- Proxies full request to Electric's `/v1/shape`
- Electric creates shape, computes handle, returns data
- Client receives data with `electric-handle` header
- Response is cached

### Example 2: Subsequent Request (Disk Mode)

**Client Request to Nginx**:
```
GET /v1/shape?table=users&offset=0_0&handle=3833821-1721812114261
```

**Nginx → Electric Metadata Request**:
```
GET /v1/shape/metadata?table=users&offset=0_0&handle=3833821-1721812114261
```

**Electric Response**:
```
HTTP/1.1 200 OK
X-Electric-Mode: disk
X-Electric-File-Path: default/3833821-1721812114261/snapshot_0.json
electric-handle: 3833821-1721812114261
electric-offset: 1002_3

{
  "mode": "disk",
  "file_path": "default/3833821-1721812114261/snapshot_0.json"
}
```

**Nginx Action**:
- Sees `X-Electric-Mode: disk`
- Reads file from `$shapes_root/default/3833821-1721812114261/snapshot_0.json`
- Serves to client with Electric headers
- Caches for 1 hour

### Example 3: Offset Not Yet on Disk (Proxy Mode)

**Client Request to Nginx**:
```
GET /v1/shape?table=users&offset=1010_0&handle=3833821-1721812114261
```

**Nginx → Electric Metadata Request**:
```
GET /v1/shape/metadata?table=users&offset=1010_0&handle=3833821-1721812114261
```

**Electric Response**:
```
HTTP/1.1 200 OK
X-Electric-Mode: proxy

{
  "mode": "proxy",
  "reason": "offset_unavailable"
}
```

**Nginx Action**:
- Sees `X-Electric-Mode: proxy`
- Proxies to Electric
- Electric serves the data dynamically

### Example 4: Request Without Handle (Proxy Mode)

**Client Request to Nginx**:
```
GET /v1/shape?table=users&offset=0_0
```

**Nginx → Electric Metadata Request**:
```
GET /v1/shape/metadata?table=users&offset=0_0
```

**Electric Response**:
```
HTTP/1.1 200 OK
X-Electric-Mode: proxy

{
  "mode": "proxy",
  "reason": "no_handle"
}
```

**Nginx Action**: Proxies to Electric (client should have provided handle)

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

### Decision Logic

Electric should decide between disk and proxy modes based on:

```elixir
def determine_mode(params) do
  cond do
    # Initial sync - need to create/compute shape
    params.offset == "-1" ->
      {:proxy, "shape_not_ready"}

    # No handle - can't serve from disk
    params.handle == nil ->
      {:proxy, "no_handle"}

    # Check if shape exists and is ready
    !shape_exists?(params.handle) ->
      {:proxy, "shape_not_found"}

    # Check if offset is available on disk
    !offset_on_disk?(params.handle, params.offset) ->
      {:proxy, "offset_unavailable"}

    # Shape is being rebuilt
    shape_rebuilding?(params.handle) ->
      {:proxy, "shape_building"}

    # All good - serve from disk
    true ->
      {:disk, get_file_info(params.handle, params.offset)}
  end
end
```

### Suggested Module Structure

```elixir
# lib/electric/plug/shape_metadata_plug.ex
defmodule Electric.Plug.ShapeMetadataPlug do
  @moduledoc """
  Metadata endpoint that tells nginx whether to serve from disk or proxy to Electric.

  Electric has full control over routing decisions - nginx simply follows instructions.
  """

  import Plug.Conn
  require Logger

  def call(conn, _opts) do
    params = parse_params(conn)

    case determine_serving_mode(params) do
      {:disk, file_info} ->
        # Tell nginx to serve from disk
        conn
        |> put_resp_header("x-electric-mode", "disk")
        |> put_resp_header("x-electric-file-path", file_info.path)
        |> put_resp_header("electric-handle", file_info.handle)
        |> put_resp_header("electric-offset", file_info.offset)
        |> send_json(conn, 200, %{
          mode: "disk",
          file_path: file_info.path,
          handle: file_info.handle,
          offset: file_info.offset
        })

      {:proxy, reason} ->
        # Tell nginx to proxy to Electric
        conn
        |> put_resp_header("x-electric-mode", "proxy")
        |> send_json(conn, 200, %{
          mode: "proxy",
          reason: reason
        })

      {:error, reason} ->
        # Error - nginx will fallback to proxy
        Logger.warn("Metadata error: #{inspect(reason)}")
        conn
        |> put_resp_header("x-electric-mode", "proxy")
        |> send_json(conn, 200, %{
          mode: "proxy",
          reason: "error"
        })
    end
  end

  defp determine_serving_mode(params) do
    cond do
      # Initial sync always goes through Electric
      params.offset == "-1" ->
        {:proxy, "shape_not_ready"}

      # offset=now goes through Electric
      params.offset == "now" ->
        {:proxy, "shape_not_ready"}

      # No handle provided
      params.handle == nil or params.handle == "" ->
        {:proxy, "no_handle"}

      # Check if we can serve from disk
      true ->
        check_disk_availability(params)
    end
  end

  defp check_disk_availability(params) do
    with {:ok, shape_handle} <- validate_handle(params.handle),
         {:ok, offset} <- parse_offset(params.offset),
         {:ok, shape_status} <- get_shape_status(shape_handle),
         :ready <- shape_status,
         {:ok, file_info} <- get_file_for_offset(shape_handle, offset) do

      {:disk, %{
        path: file_info.path,
        handle: shape_handle,
        offset: format_offset(offset)
      }}
    else
      {:error, :not_found} -> {:proxy, "shape_not_found"}
      {:error, :offset_unavailable} -> {:proxy, "offset_unavailable"}
      :building -> {:proxy, "shape_building"}
      _ -> {:proxy, "unknown"}
    end
  end

  defp get_file_for_offset(shape_handle, {tx_offset, op_offset}) do
    # Use existing Electric.ShapeCache.FileStorage functions
    # to determine which file contains this offset

    with {:ok, storage} <- ShapeCache.get_storage(shape_handle),
         {:ok, chunk_info} <- FileStorage.find_chunk_for_offset(storage, tx_offset, op_offset) do

      {:ok, %{
        path: "default/#{shape_handle}/#{chunk_info.file_name}",
        start_byte: chunk_info.start_byte,
        end_byte: chunk_info.end_byte
      }}
    else
      {:error, :not_found} -> {:error, :offset_unavailable}
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
