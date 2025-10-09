---
title: Client development - Guide
description: >-
  How to write an Electric client for any language that speaks HTTP and JSON.
outline: [2, 3]
---

<img src="/img/icons/coding.svg" class="product-icon"
    style="width: 72px"
/>

# Client development

How to write an Electric client for any language that speaks HTTP and JSON.

## HTTP and JSON

You can create a client for Electric by:

1. implementing a long-polling strategy to [consume the HTTP API](#consume-the-http-api)
2. (optionally) [materialising the shape log](#materialise-the-shape-log) into a data structure or local store
3. (optionally) [providing reactivity bindings](#reactivity-bindings)

> [!Warning] Before you start
> It's worth looking through the source code for the existing [Typescript](https://github.com/electric-sql/electric/tree/main/packages/typescript-client) and [Elixir](https://github.com/electric-sql/electric/tree/main/packages/elixir-client) clients.
> You're also welcome to [raise an issue on GitHub](https://github.com/electric-sql/electric) and [flag up your plans on Discord](https://discord.electric-sql.com).
>
> Your client also needs to be able to talk to [a running instance of Electric](./installation).

## Consume the HTTP API

The [Electric sync service](/product/electric) syncs data over an [HTTP API](/docs/api/http). The primary job of a client is to consume this API using HTTP requests.

:::tip Production Best Practice
While this guide shows direct HTTP API consumption, **production applications should proxy Electric requests through your backend API** rather than connecting clients directly to Electric. This provides security, authorization, and a clean API interface. See the [authentication guide](/docs/guides/auth) for implementation patterns.
:::

The HTTP API exposes [Shapes](/docs/guides/shapes). There are two phases to syncing a shape:

1. [initial sync](#initial-sync) where you load all the data the server is currently aware of
2. [live mode](#live-mode) where you wait for and consume live updates in real-time

### Initial sync

In the initial sync phase, you make a series of requests to get Shape data, increasing the `offset` parameter until you get an `up-to-date` message.

#### Construct your shape URL

Encode a [shape definition](/docs/guides/shapes#defining-shapes) into a `GET /v1/shape` URL. See the <a href="/openapi.html#/paths/~1v1~1shape~1%7Broot_table%7D/get">specification for the URL structure here</a>. For example, a Shape that contains all of the rows in the `items` table would be requested with:

```http
GET /v1/shape?table=items
```

#### Make the initial `offset=-1` request

The first request to a shape should set the `offset` parameter to `-1`. This indicates to Electric that you want to consume all of the data from the beginning of the [Shape log](/docs/api/http#shape-log). For example, you might make a request to:

```http
GET /v1/shape?table=items?offset=-1
```

The body of the response will contain a JSON array of messages. The headers of the response will contain two pieces of important information:

- `electric-handle` an ephemeral identifier to an existing shape log
- `electric-offset` the offset value for your next request

If the last message in the response body contains an `up-to-date` control message:

```json
{ "headers": { "control": "up-to-date" } }
```

Then the response will also contain an:

- `electric-up-to-date` header

Either of which indicate that you can [process the messages](#materialise-the-shape-log) and switch into [live mode](#live-mode). Otherwise, you should continue to accumulate messages by making additional requests to the same URL, with the new shape handle and offset. For example:

```http
GET /v1/shape?table=items&handle=38083685-1729874417404&offset=0_0
```

In this way, you keep making GET requests with increasing offsets until you load all the data that the server is aware of, at which point you get the `up-to-date` message.

### Live mode

In live mode, if the server doesn't have any new data, it will hold open your request until either a timeout or new data arrives. This allows you to implement long polling, where you keep the request open, and reconnect immediately when new data arrives.

> [!Tip] Why not websockets?!
> Consuming data over HTTP allows us to [leverage CDNs](/docs/api/http#caching), simplifies observability and allows you to implement auth (and other capabilities) [using HTTP proxies](/docs/guides/auth#recommended-pattern).

#### Add `live` and `cursor` parameters

Set `live=true` to switch Electric into live mode. Make sure your request timeout is higher than the server timeout (which defaults to `20s`)

If the previous response contains an `electric-cursor` header, then also set the `cursor` parameter to its value. (This is an extra cache-busting parameter used to normalise [request-collapsing](/docs/api/http#collapsing-live-requests) behaviour across different CDNs).

For example:

```http
GET /v1/shape?table=items&handle=38083685-1729874417404&offset=27344208_0&cursor=1674440&live=true
```

#### Keep polling

Live requests will either timeout, returning `204 No content`, or will return an array of messages and headers, just as with non live responses.

Keep pooling and whenever you get new data with an `up-to-date` header/message then [process the messages](#materialise-the-shape-log).

## Materialise the shape log

How you choose to process shape log messages is up-to you. You can:

- [stream the shape log messages](#streaming-messages) through
- materialise the shape log [into a data structure](#into-a-data-structure) or [database](#into-a-database)

### Streaming messages

If you just want a stream of logical database operations, you can simply stream or broadcast these onwards. This is what both the Typescript client [`ShapeStream`](/docs/api/clients/typescript#shapestream) class and Elixir client [`stream/3`](/docs/api/clients/elixir#stream) function do.

### Into a data structure

If you want to maintain a materialised Shape in your client, you can apply the operations in the shape log to a data structure. This is what both the Typescript client [`Shape`](/docs/api/clients/typescript#shape) class and [Redis example](/demos/redis) do.

Shape log messages are either control messages or logical `insert`, `update` or `delete` operations. You can materialise a Shape by applying these to your chosen data structure. For example, for a Javascript `Map`:

```ts
switch (message.headers.operation) {
  case `insert`:
    data.set(message.key, message.value)

    break
  case `update`:
    data.set(message.key, {
      ...data.get(message.key)!,
      ...message.value,
    })

    break
  case `delete`:
    data.delete(message.key)

    break
}
```

Note that control messages should be skipped if you client doesn't know how to interpret them.

### Into a database

As well as just a single data structure, it's possible to materialise one or more shapes into a local store. This can be very simple -- just update entries in a normalised store, no matter which shape they came through -- or can be complex, when aiming to maintain database invariants in a local embedded database such as [PGlite](/product/pglite).

> [!Tip] Syncing into a database is out of scope of this guide
> If you're interested in implementing it, [raise an Issue](https://github.com/electric-sql/electric) or [ask on Discord](https://discord.electric-sql.com).

### Transactions

Only apply logical operations to your materialised structure when you get an `up-to-date` message. Then either apply that batch of operations to your data structure or store atomically, for example using some kind of transactional application primitive, or only [trigger reactivity](#reactivity-bindings) once all the changes are applied.

## Reactivity bindings

If you maintain a materialised data structure, it's often useful to know when it changes. This is what the Typescript client's [`Shape.subscribe`](/docs/api/clients/typescript#shape) function enables, for example.

This can then be used by a framework to trigger re-rendering. See the [`useShape` React hook source code](https://github.com/electric-sql/electric/blob/main/packages/react-hooks/src/react-hooks.tsx) for a real example but in short, e.g.: for a React component:

```tsx
import { useEffect, useState } from 'react'

const MyComponent = ({ shapeDefinition }) => {
  const [data, setData] = useState([])

  useEffect(() => {
    const stream = new ShapeStream(shapeDefinition)
    const shape = new Shape(stream)

    shape.subscribe(setData)

    return () => {
      shape.unsubscribe()
    }
  }, [shapeDefinition])
}
```

How you choose to provide this kind of API is very language dependent. You could support registering callbacks (like `shape.subscribe`) and then call these whenever you've finished materialising your shape, or you could some kind of broadcast mechanism.

## Examples

Let's walk through the process of implementing a client in a real programming language.

### Brainfuck

```shell
++++++++[>++++++++++>++++++++++++++>+++++++++++++++>++++>+++++++>+++++<<<<<<-]>-.>--.--.>+.>.<<--.+++++.----.--.+++++.-------.>>.>+++.>+.
```

### Python

Let's build a simple happy-path client in Python to materialise a Shape into a `dict`. First create a new folder and make it a Python package:

```shell
mkdir example-client
cd example-client
touch __init__.py
```

Install the [Requests](https://docs.python-requests.org) HTTP client:

```shell
# Optionally in a virtualenv:
# virtualenv .venv
# source .venv/bin/activate
python -m pip install requests
```

Now let's write our `Shape` client, saving the following in `client.py`:

```python
import requests
from urllib.parse import urlencode

class Shape(object):
    """Syncs a shape log and materialises it into a `data` dict."""

    def __init__(self, base_url='http://localhost:3000', offset=-1, handle=None, table=None, where=None):
        if table is None:
            raise "Must provide a table"

        # Request state used to build the URL.
        self.base_url = base_url
        self.cursor = None
        self.handle = handle
        self.live = False
        self.offset = offset
        self.table = table
        self.where = where

        # Materialiased data.
        self.data = {}

        # Accumulated messages (waiting for an `up-to-date` to apply).
        self.messages = []

        # Registered callbacks to notify when the data changes.
        self.subscribers = []

    def subscribe(self, callback):
        """Register a function that's called whenever the data changes."""

        self.subscribers.append(callback)

    def sync(self):
        """Start syncing. Note that this blocks the current thread."""

        while True:
            self.request()

    def request(self):
        """Make a request to `GET /v1/shape` and process the response."""

        # Build the URL based on the current parameters.
        url = self.build_url()

        # Fetch the response.
        response = requests.get(url)

        # This is a happy path example, so we just log error codes.
        # A real client should handle errors, backoff, reconnect, etc.
        if response.status_code > 204:
            raise Exception("Error: {}".format(response.status_code))

        # If the response is 200 then we may have new data to process.
        if response.status_code == 200:
            self.messages.append(response.json())

            # If we're up-to-date, switch into live mode and process
            # the accumulated messages.
            if 'electric-up-to-date' in response.headers:
                self.live = True
                self.process_messages()

        # Set the shape handle, offset and optionally cursor for
        # the next request from the response headers.
        self.handle = response.headers['electric-handle']
        self.offset = response.headers['electric-offset']

        if 'electric-cursor' in response.headers:
            self.cursor = r.headers['electric-cursor']

    def process_messages(self):
        """Process any batched up messages. If the data has changed,
          notify the subscribers.
        """

        has_changed = False

        # Process the accumulated messages.
        for batch in self.messages:
            for message in batch:
                if 'operation' in message.get('headers', {}):
                    op_changed = self.apply_operation(message)
                    if op_changed:
                        has_changed = True

        # Clear the queue.
        self.messages = []

        # If the data has changed, notify the subscribers.
        if has_changed:
            self.notify_subscribers()

    def apply_operation(self, message):
        """Apply a logical operation message to the data dict.
          Return whether the data has changed.
        """

        key = message['key'].replace('"', '').split("/")[-1]
        value = message.get('value')
        operation = message['headers']['operation']

        if operation == 'insert':
            self.data[key] = value

            return True

        if operation == 'update':
            has_changed = False
            current_value = self.data[key]

            for k, v in value:
                if current_value.get(k) != v:
                    has_changed = True

            current_value.update(new_value)

            return has_changed

        if operation == 'delete':
            if key in self.data:
                del self.data[key]

                return True

        return False

    def notify_subscribers(self):
        for callback in self.subscribers:
            callback(self.data)

    def build_url(self):
        params = {
            'offset': self.offset,
            'table': self.table
        }

        if self.cursor is not None:
            params['cursor'] = self.cursor

        if self.handle is not None:
            params['handle'] = self.handle

        if self.live:
            params['live'] = True

        if self.where is not None:
            params['where'] = self.where

        return "{}/v1/shape?{}".format(self.base_url, urlencode(params))
```

Now let's create a test file to test running the client. Save the following in `client.test.py`:

```python
import multiprocessing
import unittest

from client import Shape

class TestClient(unittest.TestCase):
    def test_shape_sync(self):
        parent_conn, child_conn = multiprocessing.Pipe()

        shape = Shape(table='items')
        shape.subscribe(child_conn.send)

        p = multiprocessing.Process(target=shape.sync)
        p.start()

        data = parent_conn.recv()
        self.assertEqual(type(data), dict)

        p.kill()

if __name__ == '__main__':
    unittest.main()
```

Make sure you [have Electric running](/docs/guides/installation) and then:

```shell
$ python client.test.py
.
----------------------------------------------------------------------
Ran 1 test in 0.087s

OK
```
