# Development Guide

## CORS Configuration

This Phoenix application is configured to work with the React frontend running on `http://localhost:5173`.

### Browser Caching Issues

If you encounter CORS errors or missing Electric headers after making configuration changes:

1. **Hard Refresh**: Press `Ctrl+F5` (or `Cmd+Shift+R` on Mac) to clear browser cache
2. **Developer Tools**: Open browser dev tools and check "Disable cache" while dev tools are open
3. **Incognito Mode**: Test in an incognito/private browsing window

### CORS Headers

The application exposes the following Electric-specific headers:
- `electric-offset`: Current position in the shape log
- `electric-handle`: Unique identifier for the shape
- `electric-schema`: Schema information for the synced table

### Configuration

- **Preflight Cache**: CORS preflight responses are cached for 5 minutes (`access-control-max-age: 300`)
- **Origin Handling**: Dynamically handles the origin from the request header
- **Cache Control**: OPTIONS requests include no-cache headers to prevent aggressive caching

## Testing CORS

You can test the CORS configuration with curl:

```bash
# Test actual shape request
curl -v "http://localhost:4000/api/shapes/todos?offset=-1" -H "Origin: http://localhost:5173"

# Test preflight request
curl -v -X OPTIONS "http://localhost:4000/api/shapes/todos" \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: content-type"
```

Both should return proper CORS headers including the exposed Electric headers. 