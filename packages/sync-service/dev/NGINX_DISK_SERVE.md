# Nginx Configuration for Serving Electric Shape Requests from Disk

This document describes the `nginx-disk-serve.conf` configuration that enables serving Electric Shape HTTP requests directly from disk storage.

## Overview

The nginx configuration provides a way to serve Electric Shape data from disk-based storage, reducing load on the Electric sync service and Postgres database. This is particularly useful for:

- Serving cached shape data at the edge
- Reducing database load for frequently accessed shapes
- Providing fast initial sync responses from pre-computed snapshots
- Implementing CDN-style distribution of shape data

## Architecture

```
Client Request
      ↓
   Nginx Server (port 3002)
      ↓
   ┌──────────────────────────┐
   │  Query Parameter Check   │
   └──────────────────────────┘
      ↓
   ┌──────────────────────────┐
   │  Route to Handler        │
   │  - Initial sync          │
   │  - Live mode             │
   │  - Subset snapshot       │
   └──────────────────────────┘
      ↓
   ┌──────────────────────────┐
   │  Serve from Disk         │
   │  /var/lib/electric/shapes│
   └──────────────────────────┘
```

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
- GET requests for shape data
- DELETE requests (returns 501 - not implemented)

### 4. Internal Routing Locations

#### `/internal/shape/serve`
Routes requests based on whether a shape handle is provided.

#### `/internal/shape/with_handle`
Serves shape data when a handle is provided in the request.

#### `/internal/shape/snapshot`
Serves JSON snapshot files from disk:
- Path: `{shapes_root}/default/{handle}/snapshot_0.json`
- Falls back to log file if snapshot doesn't exist
- Sets appropriate cache headers

#### `/internal/shape/live`
Handles live mode requests (long-polling):
- Returns up-to-date control message
- Should typically be proxied to Electric service for real implementation

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

### Initial Sync Request

```bash
curl -i 'http://localhost:3002/v1/shape?table=users&offset=-1&handle=3833821-1721812114261'
```

Response:
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

### Live Mode Request

```bash
curl -i 'http://localhost:3002/v1/shape?table=users&offset=0_0&handle=3833821-1721812114261&live=true'
```

### Static Pre-computed Response

```bash
curl -i 'http://localhost:3002/v1/shape/static/users_-1_default.json'
```

### Health Check

```bash
curl http://localhost:3002/health
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

## Limitations

### 1. Shape Handle Computation

Nginx cannot compute the deterministic hash for a shape from the table parameters. This means:

- **Initial requests without a handle** (offset=-1, no handle) require fallback to Electric service
- **Subsequent requests with a handle** can be served from disk
- Consider pre-computing handles and mapping table names to handles

### 2. Live Mode

True live mode requires:
- Watching files for changes
- Holding connections until new data arrives
- Coordinating multiple concurrent requests

Nginx alone cannot implement these features. Options:
- Use the fallback proxy for live mode requests
- Implement with nginx + lua module
- Use nginx + inotify for file watching
- Route live requests to Electric service

### 3. Binary Log Files

The Electric shape log files are in binary format and require decoding. The nginx config currently:
- Serves JSON snapshot files
- Cannot decode binary log files directly
- Requires pre-converted JSON snapshots

### 4. Offset Parsing

Parsing the offset parameter (`{tx_offset}_{op_offset}`) and seeking to that position in the log file requires custom logic not available in standard nginx.

### 5. Control Messages

Injecting control messages like `up-to-date` or `must-refetch` requires application logic.

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

For production use, consider this hybrid approach:

1. **Initial sync**: Serve from nginx disk cache
2. **Live mode**: Proxy to Electric service
3. **Cache population**: Electric writes snapshot files to disk
4. **Cache invalidation**: Electric notifies nginx on shape changes

```nginx
# Hybrid approach
location /v1/shape {
    # Check for live mode
    if ($arg_live = "true") {
        proxy_pass http://electric_service;
        break;
    }

    # Try disk first, fallback to proxy
    try_files /cache/$arg_table_$arg_handle.json @proxy;
}

location @proxy {
    proxy_pass http://electric_service;
}
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
