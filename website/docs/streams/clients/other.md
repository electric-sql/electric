---
title: Clients
description: >-
  Durable Streams client libraries for a wide range of languages, including TypeScript, Python, Go, Elixir, .NET, Swift, PHP, Java, Rust, and Ruby.
outline: [2, 3]
---

# Other clients

Durable Streams has official client libraries in 10 languages. All implement the same [protocol](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md) and pass the client conformance test suite, ensuring consistent behavior regardless of which language you use.

If your language isn't listed here, you can build your own &mdash; see [Building a client](https://durablestreams.com/building-a-client) on the open [Durable&nbsp;Streams](https://durablestreams.com/) protocol&nbsp;site.

## Common features

All client libraries share the same core capabilities:

- **Exactly-once writes** -- `IdempotentProducer` uses `(producerId, epoch, seq)` tuples for server-side deduplication, safe to retry on any network error
- **Offset-based resumption** -- save the offset returned by the server and pass it back on reconnect to resume from exactly where you left off
- **Long-poll and SSE live modes** -- choose between HTTP long-polling and Server-Sent Events for real-time tailing (note: PHP supports long-poll only)
- **JSON mode with array flattening** -- JSON streams automatically handle array batching on writes and flattening on reads
- **Automatic retry on transient errors** -- configurable exponential backoff for network failures and server errors

## Summary

| Language                  | Install                                                                | Maturity                                      |
| ------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| [TypeScript](#typescript) | `npm install @durable-streams/client`                                  | <span class="nowrap">Production-Proven</span> |
| [Python](#python)         | `pip install durable-streams`                                          | <span class="nowrap">Expert-Reviewed</span>   |
| [Go](#go)                 | `go get github.com/durable-streams/durable-streams/packages/client-go` | <span class="nowrap">Expert-Reviewed</span>   |
| [Elixir](#elixir)         | Add `{:durable_streams, "~> 0.1.0"}` to `mix.exs`                      | <span class="nowrap">Vibe-Engineered</span>   |
| [C# / .NET](#c--net)      | `dotnet add package DurableStreams`                                    | <span class="nowrap">Vibe-Engineered</span>   |
| [Swift](#swift)           | Swift Package Manager (`DurableStreams`)                               | <span class="nowrap">Vibe-Engineered</span>   |
| [PHP](#php)               | `composer require durable-streams/client`                              | <span class="nowrap">Vibe-Engineered</span>   |
| [Java](#java)             | Maven / Gradle (`durable-streams`)                                     | <span class="nowrap">Vibe-Engineered</span>   |
| [Rust](#rust)             | `cargo add durable-streams`                                            | <span class="nowrap">Vibe-Engineered</span>   |
| [Ruby](#ruby)             | `gem install durable_streams`                                          | <span class="nowrap">Vibe-Engineered</span>   |

## Maturity levels

Each client follows a maturity progression:

- **Vibe-Engineered** -- implements the core protocol, passes the conformance test suite, and has basic documentation. API may change based on ecosystem feedback. Suitable for prototyping and non-critical workloads.
- **Expert-Reviewed** -- reviewed by a language/ecosystem expert for idiomatic API design, error handling, and performance. Suitable for production use.
- **Production-Proven** -- used in production by multiple organizations with a track record of stability and active maintenance. The TypeScript client is at this level with 1.5+ years of production use at Electric.

All clients pass the conformance test suite regardless of maturity level. The difference is in API polish, idiomatic patterns, and battle-testing.

If you're an expert in a language with a Vibe-Engineered client, we'd love your help leveling it up. See the [Client maturity model](https://github.com/durable-streams/durable-streams/blob/main/CLIENT_MATURITY.md) for the review process and checklist.

## TypeScript

See the dedicated [TypeScript client](typescript) page for installation, read/write examples, and exactly-once producer usage.

Full documentation: [TypeScript client](typescript)

Package README: [README](https://github.com/durable-streams/durable-streams/blob/main/packages/client/README.md)

## Python

See the dedicated [Python client](python) page for sync and async APIs, stream handles, and `IdempotentProducer` usage.

Full documentation: [Python client](python)

Package README: [README](https://github.com/durable-streams/durable-streams/blob/main/packages/client-py/README.md)

## Go

```bash
go get github.com/durable-streams/durable-streams/packages/client-go
```

```go
client := durablestreams.NewClient()
stream := client.Stream("https://streams.example.com/my-stream")

it := stream.Read(ctx)
defer it.Close()

for {
    chunk, err := it.Next()
    if errors.Is(err, durablestreams.Done) {
        break
    }
    fmt.Println(string(chunk.Data))
}
```

- Zero dependencies -- uses only the Go standard library (`net/http`)
- Iterator-based reads with `it.Next()` / `Done` sentinel pattern
- Concurrency-safe `Client` with optimized HTTP transport and connection pooling
- `IdempotentProducer` with goroutine-based batching and pipelining
- Functional options pattern (`WithLive()`, `WithOffset()`, `WithContentType()`)

Full documentation: [README](https://github.com/durable-streams/durable-streams/blob/main/packages/client-go/README.md)

## Elixir

Add to your `mix.exs`:

```elixir
{:durable_streams, "~> 0.1.0"}
```

```elixir
alias DurableStreams.Client
alias DurableStreams.Stream, as: DS

client = Client.new("http://localhost:4437")
stream = client |> Client.stream("/my-stream") |> DS.create!()

DS.append_json!(stream, %{event: "hello"})

{:ok, {items, _meta}} = DS.read_json(stream, offset: "-1")
IO.inspect(items)
```

- OTP-native design with `Consumer` and `Writer` GenServers for supervision tree integration
- Pipe-friendly API with bang (`!`) and `{:ok, _}` / `{:error, _}` variants
- `Writer` GenServer for fire-and-forget batched writes with exactly-once delivery
- `Consumer` GenServer with automatic reconnection, exponential backoff, and callback-based processing
- No external dependencies -- uses Erlang's built-in `:httpc` (optional Finch for SSE)

Full documentation: [README](https://github.com/durable-streams/durable-streams/blob/main/packages/client-elixir/README.md)

## C# / .NET

```bash
dotnet add package DurableStreams
```

```csharp
using DurableStreams;

await using var client = new DurableStreamClient(new DurableStreamClientOptions
{
    BaseUrl = "https://streams.example.com"
});
var stream = client.GetStream("/my-stream");

await using var response = await stream.StreamAsync(new StreamOptions
{
    Offset = Offset.Beginning,
    Live = LiveMode.Off
});
var items = await response.ReadAllJsonAsync<MyEvent>();
```

- `IAsyncEnumerable<T>` support for natural `await foreach` consumption
- Thread-safe `DurableStreamClient` designed for singleton/DI registration
- `IdempotentProducer` with `OnError` event handler for fire-and-forget writes
- `StreamCheckpoint` type for easy offset + cursor persistence
- ASP.NET Core integration with `IAsyncEnumerable` controller actions

Full documentation: [README](https://github.com/durable-streams/durable-streams/blob/main/packages/client-dotnet/README.md)

## Swift

Add via Swift Package Manager:

```swift
dependencies: [
    .package(url: "https://github.com/durable-streams/durable-streams", from: "0.1.0")
]
```

```swift
import DurableStreams

let handle = try await DurableStream.connect(
    url: URL(string: "https://streams.example.com/my-stream")!
)
for try await event in handle.messages(as: MyEvent.self) {
    print(event)
}
```

- `AsyncSequence`-based streaming with `for try await` syntax
- `Codable` offsets for easy persistence to `UserDefaults` or `Keychain`
- iOS lifecycle integration with suspend/resume and background flush support
- Batching presets (`.highThroughput`, `.lowLatency`, `.disabled`)
- Dynamic headers via `.provider { await getToken() }` closures

Full documentation: [README](https://github.com/durable-streams/durable-streams/blob/main/packages/client-swift/README.md)

## PHP

```bash
composer require durable-streams/client
```

```php
use function DurableStreams\stream;

$response = stream([
    'url' => 'https://streams.example.com/my-stream',
    'offset' => '-1',
]);

foreach ($response->jsonStream() as $event) {
    echo json_encode($event) . "\n";
}
```

- Generator-based streaming for memory-efficient consumption with PHP's native `yield`
- `IdempotentProducer` with synchronous `enqueue()` / `flush()` model
- PSR-18 compatible -- use any HTTP client (Guzzle, Symfony, etc.) or the built-in cURL client
- PSR-3 structured logging support
- **Note:** Long-poll only (no SSE support due to PHP's synchronous execution model)

Full documentation: [README](https://github.com/durable-streams/durable-streams/blob/main/packages/client-php/README.md)

## Java

```kotlin
// Gradle
implementation("com.durablestreams:durable-streams:0.1.0")
```

```java
var client = DurableStream.create();

try (var chunks = client.read(url)) {
    for (var chunk : chunks) {
        System.out.println(chunk.getDataAsString());
    }
}
```

- Zero dependencies -- uses only JDK 11+ APIs (`java.net.http.HttpClient`)
- Type-safe `JsonIterator<T>` with pluggable JSON parsers (Gson, Jackson, etc.)
- `AutoCloseable` iterators for natural try-with-resources usage
- `CompletableFuture` async variants for all operations
- Thread-safe `DurableStream` client and `IdempotentProducer`

Full documentation: [README](https://github.com/durable-streams/durable-streams/blob/main/packages/client-java/README.md)

## Rust

Add to your `Cargo.toml`:

```toml
[dependencies]
durable-streams = "0.1"
```

```rust
use durable_streams::{Client, Offset};

let client = Client::new();
let stream = client.stream("https://streams.example.com/my-stream");

let mut reader = stream.read().offset(Offset::Beginning).build();
while let Some(chunk) = reader.next_chunk().await? {
    println!("{:?}", String::from_utf8_lossy(&chunk.data));
}
```

- Builder pattern for client, reader, and producer configuration
- `Producer` with fire-and-forget `append()` / `append_json()` and `on_error` callback
- Feature flags for TLS backend (`rustls` default, optional `native-tls`) and `tracing` integration
- Tokio-based async runtime
- Uses `reqwest` under the hood with connection pooling

Full documentation: [README](https://github.com/durable-streams/durable-streams/blob/main/packages/client-rust/README.md)

## Ruby

```bash
gem install durable_streams
```

```ruby
require 'durable_streams'

stream = DurableStreams.create("/my-stream", content_type: :json)
stream << { event: "hello" }
stream.read.each { |msg| puts msg }
```

- Idiomatic Ruby with `Enumerable` integration, `each` / `each_batch`, and `<<` shovel operator
- `Producer.open` block form for automatic flush/close on exit
- Lazy enumerator support (`stream.read(live: :sse).each.lazy.take(10).to_a`)
- Global configuration with `DurableStreams.configure` and isolated contexts for multi-tenant use
- Built-in testing utilities with mock transport for RSpec/Minitest

Full documentation: [README](https://github.com/durable-streams/durable-streams/blob/main/packages/client-rb/README.md)
