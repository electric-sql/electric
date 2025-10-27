# Nginx Configuration for Serving Electric Shape Requests from Disk

This document describes the `nginx-disk-serve.conf` configuration that enables serving Electric Shape HTTP requests directly from disk storage.

## Overview

The nginx configuration provides a way to serve Electric Shape data from disk-based storage, reducing load on the Electric sync service and Postgres database. This is particularly useful for:

- Serving cached shape data at the edge
- Reducing database load for frequently accessed shapes
- Providing fast initial sync responses from pre-computed snapshots
- Implementing CDN-style distribution of shape data

## Architecture

The nginx configuration uses a hybrid approach: proxying to Electric for live mode and initial requests, while serving subsequent requests from disk for optimal performance.

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Request                         │
│                  GET /v1/shape?table=...                    │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                    Nginx (port 3002)                        │
│                  Parameter Validation                       │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
                  ┌────┴────┐
                  │ Route?  │
                  └────┬────┘
        ┌─────────────┼─────────────┬──────────────┐
        ↓             ↓             ↓              ↓
   live=true    offset=-1      no handle    has handle
        │             │             │         & offset
        ↓             ↓             ↓              ↓
┌───────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐
│   Proxy   │  │  Proxy   │  │  Proxy   │  │   Query     │
│  to       │  │  to      │  │  to      │  │  Electric   │
│  Electric │  │ Electric │  │ Electric │  │  Metadata   │
│  (Live)   │  │ (Initial)│  │          │  │             │
└─────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬──────┘
      │             │              │                │
      │             │              │                ↓
      │             │              │        ┌────────────────┐
      │             │              │        │ Get byte range │
      │             │              │        │ for offset     │
      │             │              │        └───────┬────────┘
      │             │              │                ↓
      │             │              │        ┌────────────────┐
      │             │              │        │ Serve bytes    │
      │             │              │        │ from disk      │
      │             │              │        └───────┬────────┘
      ↓             ↓              ↓                ↓
┌──────────────────────────────────────────────────────────┐
│                    Response to Client                     │
│      Headers: electric-handle, electric-offset, etc.     │
│      Body: JSON shape log operations                     │
│      X-Served-By: nginx-proxy-live|nginx-disk|etc.      │
└──────────────────────────────────────────────────────────┘
```

### Request Flow Details

1. **Live Mode (`live=true`)**: Proxied directly to Electric for real-time long-polling
2. **Initial Sync (`offset=-1`)**: Proxied to Electric to establish shape and get handle
3. **No Handle**: Proxied to Electric (client should have handle for disk serving)
4. **With Handle & Offset**: Query Electric metadata endpoint for byte offsets, serve from disk

## Directory Structure

Shape data is expected to be stored in the following structure:

```
/var/lib/electric/shapes/
├── default/                          # Stack ID
│   ├── {shape_handle}/              # e.g., "3833821-1721812114261"
│   │   ├── log                      # Binary log file
│   │   ├── snapshot_0.json          # First snapshot chunk
│   │   ├── snapshot_1.json          # Additional chunks
│   │   └── metadata                 # Shape metadata
│   └── {another_handle}/
│       └── ...
└── static/                          # Pre-generated responses
    ├── users_-1_default.json        # Pre-computed initial sync
    └── posts_0_0_full.json          # Pre-computed responses
```

## Configuration Sections

### 1. Main HTTP Block

```nginx
http {
    # Logging with custom format for shape requests
    log_format shape_requests '...query params...';

    # Gzip compression for JSON responses
    gzip on;
    gzip_types application/json;

    # Cache path for shape data
    proxy_cache_path /var/cache/nginx/shapes ...;
}
```

### 2. CORS Support

All responses include CORS headers to allow cross-origin requests:

```nginx
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD, DELETE, OPTIONS
Access-Control-Expose-Headers: electric-handle, electric-offset, ...
```

### 3. Main Shape Endpoint (`/v1/shape`)

Handles the primary Shape API endpoint with:
- Parameter validation (table and offset required)
- OPTIONS preflight requests
- Intelligent routing based on request type
- DELETE requests (proxied to Electric)

### 4. Internal Routing Locations

#### `/internal/proxy/live`
Proxies live mode requests directly to Electric:
- Preserves long-polling behavior
- No caching (live data must be fresh)
- Extended timeouts (300s) for long-polling
- Disables buffering for real-time streaming

#### `/internal/proxy/initial`
Proxies initial sync requests to Electric:
- Handles offset=-1 and offset=now
- Computes shape handle
- Creates initial snapshot if needed
- Enables caching of responses
- Returns electric-handle header for subsequent requests

#### `/internal/shape/with_metadata`
Serves data from disk using Electric's metadata:
- Queries `/v1/shape/metadata` endpoint via subrequest
- Gets file path and byte offsets for the requested offset
- Serves the specific bytes from disk
- Sets proper Electric headers
- Falls back to Electric if disk serving fails

#### `/internal/electric/metadata`
Subrequest to Electric's metadata endpoint:
- Maps shape offset to disk file location
- Returns byte ranges to read
- Lightweight query (no data transfer)
- See `ELECTRIC_METADATA_API.md` for implementation details

#### `@fallback_to_electric`
Named location for error handling:
- Used when disk files are not found
- Proxies entire request to Electric
- Enables caching for future requests
- Logs fallback events for monitoring

### 5. Static File Serving (`/v1/shape/static/`)

Serves pre-generated JSON shape responses:
- Files named: `{table}_{offset}_{params_hash}.json`
- Enables aggressive caching
- Useful for frequently accessed shape configurations

### 6. Fallback to Electric Service (`/v1/fallback/`)

Optional fallback that proxies to the Electric sync service:
- Used when disk serving fails
- Implements caching proxy behavior
- Supports long-polling for live mode

## Setup Instructions

### 1. Install Nginx

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install nginx

# macOS
brew install nginx

# RHEL/CentOS
sudo yum install nginx
```

### 2. Configure Paths

Edit the configuration file to set your shape storage path:

```nginx
set $shapes_root /var/lib/electric/shapes;
```

### 3. Create Required Directories

```bash
# Shape storage directory
sudo mkdir -p /var/lib/electric/shapes/default
sudo mkdir -p /var/lib/electric/shapes/static

# Cache directory
sudo mkdir -p /var/cache/nginx/shapes

# Log directory
sudo mkdir -p /var/log/nginx

# Error response directory
sudo mkdir -p /usr/share/nginx/html/errors

# Set permissions
sudo chown -R nginx:nginx /var/lib/electric/shapes
sudo chown -R nginx:nginx /var/cache/nginx/shapes
```

### 4. Create Error Response Files

```bash
# 400 Bad Request
echo '{"error": "Bad Request", "message": "Invalid parameters"}' | \
  sudo tee /usr/share/nginx/html/errors/400.json

# 404 Not Found
echo '{"error": "Not Found", "message": "Shape not found"}' | \
  sudo tee /usr/share/nginx/html/errors/404.json

# 5xx Server Error
echo '{"error": "Server Error", "message": "Internal server error"}' | \
  sudo tee /usr/share/nginx/html/errors/5xx.json
```

### 5. Test Configuration

```bash
sudo nginx -t -c /path/to/nginx-disk-serve.conf
```

### 6. Start Nginx

```bash
sudo nginx -c /path/to/nginx-disk-serve.conf
```

Or reload if already running:

```bash
sudo nginx -s reload
```

## Usage Examples

### 1. Initial Sync Request (Proxied to Electric)

When offset=-1, nginx proxies to Electric to establish the shape and get a handle:

```bash
curl -i 'http://localhost:3002/v1/shape?table=users&offset=-1'
```

Response headers:
```
HTTP/1.1 200 OK
electric-handle: 3833821-1721812114261
electric-offset: 1002_3
electric-up-to-date: true
X-Served-By: nginx-proxy-initial
X-Proxy-Cache: MISS
```

Response body:
```json
[
  {
    "headers": {
      "operation": "insert",
      "lsn": "0/16B3F70"
    },
    "key": "1",
    "value": {
      "id": "1",
      "name": "Alice"
    }
  },
  {
    "headers": {
      "control": "up-to-date"
    }
  }
]
```

**What happened**: Nginx proxied to Electric, which computed the shape handle, created/served the snapshot, and returned it with the handle header.

### 2. Subsequent Request with Handle (Served from Disk)

Now that we have a handle, subsequent requests can be served from disk:

```bash
curl -i 'http://localhost:3002/v1/shape?table=users&offset=0_0&handle=3833821-1721812114261'
```

Response headers:
```
HTTP/1.1 200 OK
electric-handle: 3833821-1721812114261
electric-offset: 1002_3
X-Served-By: nginx-disk
Cache-Control: public, max-age=3600, stale-while-revalidate=86400
```

**What happened**:
1. Nginx queried Electric's metadata endpoint: `/v1/shape/metadata?table=users&offset=0_0&handle=...`
2. Electric returned file path and byte offsets
3. Nginx served the bytes directly from disk
4. Response is cacheable for 1 hour

### 3. Live Mode Request (Proxied to Electric)

Live mode is always proxied to Electric for real-time updates:

```bash
curl -i 'http://localhost:3002/v1/shape?table=users&offset=1002_3&handle=3833821-1721812114261&live=true'
```

Response headers:
```
HTTP/1.1 200 OK
electric-handle: 3833821-1721812114261
electric-cursor: 1002_3:1234567890
X-Served-By: nginx-proxy-live
Cache-Control: no-cache, no-store, must-revalidate
```

**What happened**: Nginx proxied the entire request to Electric, which held the connection open (long-polling) until new data arrived or timeout. No caching for live requests.

### 4. Pagination Request (Served from Disk)

When a shape is too large for one response, use the electric-offset header:

```bash
curl -i 'http://localhost:3002/v1/shape?table=users&offset=1002_3&handle=3833821-1721812114261'
```

**What happened**: Same as example 2 - queries metadata for the next chunk, serves from disk.

### 5. Static Pre-computed Response

For frequently accessed shapes, serve from pre-generated static files:

```bash
curl -i 'http://localhost:3002/v1/shape/static/users_-1_default.json'
```

Response headers:
```
X-Served-By: nginx-static
Cache-Control: public, max-age=3600, stale-while-revalidate=86400
```

**What happened**: Pure nginx static file serving, no Electric involvement at all.

### 6. Health Check

```bash
curl http://localhost:3002/health
# OK
```

### 7. Checking Which Mode Was Used

All responses include the `X-Served-By` header showing how the request was handled:

- `nginx-proxy-live`: Live mode, proxied to Electric
- `nginx-proxy-initial`: Initial sync, proxied to Electric
- `nginx-disk`: Served from disk using metadata
- `nginx-fallback`: Disk serving failed, fell back to Electric
- `nginx-static`: Served from static pre-generated file

```bash
curl -s -D - 'http://localhost:3002/v1/shape?table=users&offset=0_0&handle=3833821-1721812114261' | grep X-Served-By
# X-Served-By: nginx-disk
```

## Pre-generating Static Shape Responses

To maximize performance, you can pre-generate static JSON files for common shape requests:

```bash
# Example: Pre-generate initial sync for users table
curl 'http://localhost:3000/v1/shape?table=users&offset=-1' \
  > /var/lib/electric/shapes/static/users_-1_default.json

# Pre-generate with filters
curl 'http://localhost:3000/v1/shape?table=posts&offset=-1&where=status%3Dpublished' \
  > /var/lib/electric/shapes/static/posts_-1_published.json
```

Then create nginx rewrites to map requests to these files:

```nginx
location ~* "^/v1/shape.*table=users.*offset=-1" {
    rewrite ^ /v1/shape/static/users_-1_default.json last;
}
```

## Limitations and Design Decisions

### ✅ Fully Supported Features

1. **Live Mode**: Proxied to Electric with proper long-polling support
2. **Initial Sync**: Proxied to Electric to establish shapes and get handles
3. **Caching**: Aggressive caching for non-live requests
4. **DELETE Operations**: Proxied to Electric for proper handling
5. **CORS**: Full CORS support with proper headers

### ⚠️ Current Limitations

### 1. Metadata Endpoint Required

The disk-serving mode requires Electric to implement a `/v1/shape/metadata` endpoint that:
- Maps offsets to byte positions in files
- Returns file paths and byte ranges
- See `ELECTRIC_METADATA_API.md` for full specification

**Current behavior**: Without the metadata endpoint, nginx falls back to proxying all non-live, non-initial requests to Electric.

### 2. Byte-Range Serving

The current implementation serves entire snapshot files. For true byte-range serving:
- Requires the metadata endpoint (see above)
- May require nginx Lua (OpenResty) for precise byte extraction
- Can use nginx's built-in byte-range support with proper `Range` headers

**Current behavior**: Serves full snapshot files from disk when handle is provided.

### 3. Binary Log Files

Electric's binary log files require decoding:
- Current implementation serves JSON snapshot files
- Binary log files cannot be served directly without decoding
- Electric should export JSON snapshots or provide decoded data

**Workaround**:
- Pre-convert log files to JSON format
- Use Electric's snapshot files instead of raw logs
- Implement decoding in nginx Lua module

### 4. Shape Handle Discovery

Nginx cannot compute shape handles from table parameters:
- Initial requests must go through Electric
- Clients must preserve the `electric-handle` header from initial sync
- No way to "guess" handles for disk serving

**This is by design**: Handle computation involves complex hashing and database state.

### 5. Control Message Generation

Control messages (`up-to-date`, `must-refetch`, `snapshot-end`) require application logic:
- These are embedded in shape log files
- Nginx cannot generate new control messages
- Must be present in the served files

**Current behavior**: Control messages are served as-is from snapshot files.

## Advanced Setup: Nginx + Lua

For a more complete implementation, consider using [OpenResty](https://openresty.org/) (nginx + Lua):

```lua
-- Example Lua handler for shape requests
local function serve_shape()
    local args = ngx.req.get_uri_args()
    local handle = args.handle
    local offset = args.offset

    -- Parse offset
    local tx_offset, op_offset = parse_offset(offset)

    -- Read from log file
    local data = read_shape_log(handle, tx_offset, op_offset)

    -- Format response
    local response = format_shape_response(data)

    ngx.header["electric-handle"] = handle
    ngx.header["electric-offset"] = format_offset(tx_offset, op_offset)
    ngx.say(response)
end
```

## Integration with Electric Sync Service

The provided nginx configuration implements a **hybrid approach** that balances performance and functionality:

### Current Architecture (Implemented)

```
┌─────────────────────────────────────────────────────────┐
│                    Request Type                         │
└────────┬────────────────────────────┬───────────────────┘
         │                            │
    ┌────┴─────┐                 ┌────┴─────┐
    │  Proxy   │                 │   Disk   │
    │  Route   │                 │  Route   │
    └────┬─────┘                 └────┬─────┘
         │                            │
    ┌────┴──────────────┐      ┌──────┴────────────┐
    │ • live=true       │      │ • has handle      │
    │ • offset=-1       │      │ • has offset      │
    │ • no handle       │      │ • not live        │
    │ • DELETE          │      │                   │
    └────┬──────────────┘      └──────┬────────────┘
         │                            │
    ┌────▼──────────┐          ┌──────▼────────────┐
    │   Electric    │          │  Query Metadata   │
    │   Service     │          │  Serve from Disk  │
    │   (3000)      │          │  Fallback if fail │
    └───────────────┘          └───────────────────┘
```

### Benefits of This Approach

1. **Live Mode Works**: Real-time updates via Electric's long-polling
2. **Initial Sync Cached**: Electric handles shape creation, nginx caches responses
3. **Disk Serving Scales**: Subsequent requests served from disk reduce Electric load
4. **Graceful Fallback**: If disk serving fails, automatically proxies to Electric
5. **CDN Compatible**: All responses have proper cache headers
6. **Observable**: X-Served-By header shows which path was used

### Data Flow

#### Phase 1: Initial Client Connection
```
Client → nginx (offset=-1) → Electric
  ← Creates shape, computes handle, writes snapshot to disk
  ← Returns data + electric-handle header
  ← nginx caches response
```

#### Phase 2: Subsequent Requests
```
Client → nginx (offset=X, handle=Y)
  → Queries Electric metadata endpoint
  ← Gets file path + byte offsets
  → Serves bytes from disk
  ← Returns data (cached for 1h)
```

#### Phase 3: Live Updates
```
Client → nginx (live=true, handle=Y, offset=X)
  → Proxies directly to Electric
  ← Electric holds connection (long-polling)
  ← Returns new data when available
  ← No caching
```

### Configuration Requirements

For this to work, you need:

1. **Electric running on localhost:3000** (or update upstream)
2. **Electric writing snapshot files** to shared disk location
3. **Electric metadata endpoint** (optional, for byte-range serving)
4. **Shared storage** between Electric and nginx (same filesystem or NFS)

```nginx
# Configure shared storage path
set $shapes_root /var/lib/electric/shapes;

# Ensure Electric writes to the same location
# In Electric config:
# ELECTRIC_STORAGE_PATH=/var/lib/electric/shapes
```

## Monitoring

### Log Analysis

```bash
# Watch shape requests
tail -f /var/log/nginx/shape_access.log

# Count requests by table
awk '{print $NF}' /var/log/nginx/shape_access.log | \
  grep -oP 'table=\K[^ ]+' | sort | uniq -c

# Average response size
awk '{sum+=$10; count++} END {print sum/count}' /var/log/nginx/shape_access.log
```

### Cache Statistics

```bash
# Check cache size
du -sh /var/cache/nginx/shapes

# Count cached items
find /var/cache/nginx/shapes -type f | wc -l
```

### Performance Metrics

Add stub_status module for metrics:

```nginx
location /nginx_status {
    stub_status on;
    access_log off;
    allow 127.0.0.1;
    deny all;
}
```

## Security Considerations

1. **Authentication**: Add authentication layer before nginx
2. **Rate limiting**: Implement rate limits per client
3. **Input validation**: Validate all query parameters
4. **Path traversal**: Ensure shapes_root is properly contained
5. **CORS**: Restrict Access-Control-Allow-Origin in production

Example rate limiting:

```nginx
http {
    limit_req_zone $binary_remote_addr zone=shape_limit:10m rate=10r/s;

    server {
        location /v1/shape {
            limit_req zone=shape_limit burst=20 nodelay;
            # ... rest of config
        }
    }
}
```

## Performance Tuning

### Worker Processes

```nginx
worker_processes auto;
worker_rlimit_nofile 65535;

events {
    worker_connections 4096;
    use epoll;
    multi_accept on;
}
```

### Buffering

```nginx
http {
    output_buffers 2 1m;
    aio threads;
    directio 4m;
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
}
```

### Cache Tuning

```nginx
proxy_cache_path /var/cache/nginx/shapes
    levels=1:2
    keys_zone=shape_cache:500m
    max_size=50g
    inactive=7d
    use_temp_path=off
    loader_threshold=300ms
    loader_files=200;
```

## Troubleshooting

### Issue: 404 errors for shape requests

**Cause**: Shape files not found on disk

**Solution**:
- Verify shape storage path
- Check file permissions
- Ensure Electric has written snapshot files
- Use fallback proxy

### Issue: Binary data in response

**Cause**: Serving raw log files instead of JSON snapshots

**Solution**:
- Ensure snapshot JSON files exist
- Update try_files order
- Pre-generate JSON snapshots

### Issue: CORS errors in browser

**Cause**: Missing or incorrect CORS headers

**Solution**:
- Verify Access-Control-* headers
- Check OPTIONS handling
- Test with curl first

### Issue: Slow performance

**Cause**: No caching or large files

**Solution**:
- Enable proxy caching
- Use gzip compression
- Implement directio for large files
- Add aio threads

## Contributing

To improve this configuration:

1. Test with various shape definitions
2. Benchmark performance
3. Add Lua extensions for complex logic
4. Implement proper offset parsing
5. Add monitoring and metrics

## References

- [Electric HTTP API Documentation](https://electric-sql.com/docs/api/http)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [OpenResty for Lua support](https://openresty.org/)
- [Electric Shape Cache Implementation](../lib/electric/shape_cache/)
