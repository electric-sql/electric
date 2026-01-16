# Troubleshooting Electric SQL Proxy Headers and SSE Issues

This document investigates and provides solutions for common issues when using Electric SQL through a custom proxy, particularly with SvelteKit and TanStack DB.

## Symptoms

- Console warnings: `Missing headers, retrying: The response for the shape request didn't include the following required headers: electric-cursor`
- Warning: `[Electric] SSE connections are closing immediately (possibly due to proxy buffering or misconfiguration). Falling back to long polling.`
- UI falls back to original state after leaving the tab open for a while
- After page refresh, data appears in the correct position

## Root Cause Analysis

### Problem 1: Missing `electric-cursor` Header

The `electric-cursor` header is **required for live polling requests** (`live=true`). The Electric client checks for this header when responses come back from live queries.

**Key Issue: CORS and Header Exposure**

Electric's server sets `Access-Control-Expose-Headers` to expose all `electric-*` headers:

```
electric-cursor, electric-handle, electric-offset, electric-schema,
electric-up-to-date, electric-internal-known-error, retry-after
```

However, **when the browser makes a request to your proxy**, the browser only respects CORS headers from the **direct server** (your proxy), not from the upstream Electric server. Even though Electric sends the correct CORS headers, your proxy needs to ALSO send them for the browser to read the Electric-specific headers.

### Problem 2: SSE Connection Closing Immediately

The warning message indicates your proxy is **buffering SSE responses** instead of streaming them. Most frameworks and reverse proxies buffer responses by default, which breaks Server-Sent Events.

### Problem 3: UI Falling Back to Original State After Tab Idle

When a tab is hidden, the Electric client **pauses** the stream. When it becomes visible again, it **resumes** from the last offset. Issues after tab idle can be caused by:

1. **Session expiration** - If your proxy checks authentication and the session expires while the tab is idle, subsequent requests might fail
2. **Shape handle invalidation** - If Electric invalidates the shape while the tab is idle, the client gets a 409 and resets

## Solution

### Updated Proxy Implementation (SvelteKit)

```typescript
// src/routes/api/electric/+server.ts
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const ELECTRIC_URL = process.env.ELECTRIC_URL || 'http://localhost:3000';

// All Electric protocol query params that should be forwarded
const ELECTRIC_PROTOCOL_QUERY_PARAMS = [
    'offset',
    'handle',
    'live',
    'cursor',
    'columns',
    'replica',
    'where',
    'params',
    'log',
    'live_sse',
    'experimental_live_sse',
];

// Electric headers that must be exposed for the client to read
const ELECTRIC_HEADERS_TO_EXPOSE = [
    'electric-cursor',
    'electric-handle',
    'electric-offset',
    'electric-schema',
    'electric-up-to-date',
    'electric-internal-known-error',
    'retry-after',
];

export const GET: RequestHandler = async (event) => {
    const { url, locals, request } = event;

    if (!locals.session || !locals.user) {
        error(401, 'Unauthorized');
    }

    if (!url.searchParams.get('table')) {
        error(400, 'Missing table parameter');
    }

    const { user, session } = locals;
    const organizationId = session.activeOrganizationId;
    const token = process.env.ELECTRIC_SECRET ?? '';

    // Build Electric URL
    const electricUrl = new URL(`/v1/shape`, ELECTRIC_URL);

    // Forward Electric protocol params
    url.searchParams.forEach((value, key) => {
        if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
            electricUrl.searchParams.set(key, value);
        }
    });

    // Apply organization-based filtering
    if (user.role !== 'admin') {
        if (!organizationId) {
            electricUrl.searchParams.set('where', '1=0');
        } else {
            electricUrl.searchParams.set('where', `organization_id = '${organizationId}'`);
        }
    }

    electricUrl.searchParams.set('table', url.searchParams.get('table')!);
    electricUrl.searchParams.set('secret', token);

    // Forward relevant headers from client request
    const requestHeaders = new Headers();
    const forwardHeaders = ['if-none-match', 'if-modified-since', 'accept'];
    forwardHeaders.forEach(header => {
        const value = request.headers.get(header);
        if (value) requestHeaders.set(header, value);
    });

    const response = await fetch(electricUrl.toString(), {
        headers: requestHeaders,
    });

    // Build response headers
    const responseHeaders = new Headers();

    // Copy all headers from Electric response
    response.headers.forEach((value, key) => {
        // Skip problematic headers
        if (key.toLowerCase() === 'content-encoding') return;
        if (key.toLowerCase() === 'content-length') return;
        if (key.toLowerCase() === 'transfer-encoding') return;
        responseHeaders.set(key, value);
    });

    // CRITICAL: Ensure CORS headers are set for the browser to read Electric headers
    responseHeaders.set('Access-Control-Allow-Origin', request.headers.get('origin') || '*');
    responseHeaders.set('Access-Control-Expose-Headers', ELECTRIC_HEADERS_TO_EXPOSE.join(','));
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

    // Set Vary header for proper caching
    responseHeaders.set('Vary', 'Authorization, Origin');

    // For SSE: Disable buffering headers
    if (url.searchParams.get('live_sse') === 'true' ||
        url.searchParams.get('experimental_live_sse') === 'true') {
        responseHeaders.set('X-Accel-Buffering', 'no');  // Nginx
        responseHeaders.set('Cache-Control', 'no-cache, no-transform');
    }

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
    });
};

// Handle CORS preflight
export const OPTIONS: RequestHandler = async ({ request }) => {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
            'Access-Control-Expose-Headers': ELECTRIC_HEADERS_TO_EXPOSE.join(','),
            'Access-Control-Max-Age': '86400',
        },
    });
};
```

### Reverse Proxy Configuration

If you're using a reverse proxy (Nginx, Caddy) in front of your SvelteKit app, configure it for SSE:

#### Nginx

```nginx
location /api/electric {
    proxy_pass http://localhost:5173;  # or your SvelteKit port
    proxy_buffering off;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_set_header X-Accel-Buffering 'no';
}
```

#### Caddy

```caddyfile
handle /api/electric* {
    reverse_proxy localhost:5173 {
        flush_interval -1
    }
}
```

## Tab Idle Behavior Explained

The Electric client has a visibility change handler that pauses the stream when the tab is hidden and resumes when it becomes visible. The issue sequence is:

1. **Tab goes hidden** → Stream pauses
2. **Time passes** → Your session might expire OR Electric might clean up stale shapes
3. **Tab becomes visible** → Stream resumes, client sends request with old offset/handle
4. **Problems occur**:
   - If session expired: Your proxy returns 401 (or a malformed response)
   - If shape was cleaned up: Electric returns 409, client resets and re-syncs
   - If response is cached: The cached response might not have the right headers

## Debugging Tips

Add logging to your proxy to see what's happening:

```typescript
console.log('Electric request:', {
    table: url.searchParams.get('table'),
    offset: url.searchParams.get('offset'),
    handle: url.searchParams.get('handle'),
    live: url.searchParams.get('live'),
});

console.log('Electric response:', {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
});
```

## TanStack DB Collection Configuration

When using TanStack DB, ensure your collection has proper error handling:

```typescript
export const myCollection = createCollection(
    electricCollectionOptions({
        id: 'my-collection',
        shapeOptions: {
            url: '/api/electric',  // Your proxy URL
            params: { table: 'my_table' },
            parser: {
                timestamptz: (date) => new Date(date)
            },
        },
        schema: mySchema,
        getKey: (item) => item.id,
        // Add error handler to see what's happening
        onError: async (error) => {
            console.error('Collection sync error:', error);
            // Return {} to retry, or undefined to stop
            return {};
        },
    })
);
```

## Summary

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Missing `electric-cursor` header | Browser can't read headers not in `Access-Control-Expose-Headers` from your proxy | Add `Access-Control-Expose-Headers: electric-cursor,electric-handle,...` to proxy response |
| SSE fallback to long polling | Proxy buffering SSE responses | Add `X-Accel-Buffering: no` header, configure reverse proxy |
| UI resets after tab idle | Session expiration OR shape invalidation during idle period | Extend session timeout, add error handling in collection |

The **most critical fix** is ensuring your proxy explicitly sets `Access-Control-Expose-Headers` to include all the Electric headers. Even though Electric sends this header, your proxy needs to re-send it because the browser's CORS enforcement only looks at the direct response from your proxy server, not the upstream Electric server.
