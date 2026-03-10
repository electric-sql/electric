# Elixir Dependency Update Progress

## Date: 2026-03-10

## Packages Updated

### packages/sync-service
| Dependency | From | To | Type |
|---|---|---|---|
| bandit | 1.8.0 | 1.10.3 | minor |
| db_connection | 2.8.1 | 2.9.0 | minor (transitive) |
| dialyxir | 1.4.6 | 1.4.7 | patch |
| dotenvy | 1.1.0 | 1.1.1 | patch |
| ecto | 3.13.4 | 3.13.5 | patch |
| erlex | 0.2.7 | 0.2.8 | patch (transitive) |
| ex_doc | 0.39.1 | 0.40.1 | minor |
| finch | 0.20.0 | 0.21.0 | minor (transitive) |
| makeup_erlang | 1.0.2 | 1.0.3 | patch (transitive) |
| plug | 1.18.1 | 1.19.1 | minor |
| postgrex | 0.21.1 | 0.22.0 | minor |
| req | 0.5.15 | 0.5.17 | patch |
| stream_data | 1.2.0 | 1.3.0 | minor |
| telemetry | 1.3.0 | 1.4.1 | minor (transitive) |
| thousand_island | 1.4.2 | 1.4.3 | patch (transitive) |

### packages/elixir-client
| Dependency | From | To | Type |
|---|---|---|---|
| bandit | 1.10.2 | 1.10.3 | patch (transitive) |
| dialyxir | 1.4.6 | 1.4.7 | patch |
| ecto_sql | 3.13.2 | 3.13.5 | patch |
| electric | 1.3.3 | 1.4.13 | minor (constraint updated) |
| erlex | 0.2.7 | 0.2.8 | patch (transitive) |
| ex_doc | 0.39.1 | 0.40.1 | minor |
| makeup_erlang | 1.0.2 | 1.0.3 | patch (transitive) |
| plug_cowboy | 2.7.4 | 2.8.0 | minor (transitive) |
| telemetry | 1.3.0 | 1.4.1 | minor (transitive) |

**Code change:** Updated version constraint for `electric` dependency from `"~> 1.1.11 or ~> 1.2.4 or ~> 1.3.3"` to `"~> 1.1.11 or ~> 1.2.4 or ~> 1.3.3 or ~> 1.4.0"` in `mix.exs`.

### packages/electric-telemetry
| Dependency | From | To | Type |
|---|---|---|---|
| ex_doc | 0.39.1 | 0.40.1 | minor |
| finch | 0.20.0 | 0.21.0 | minor (transitive) |
| makeup_erlang | 1.0.2 | 1.0.3 | patch (transitive) |
| otel_metric_exporter | 0.4.2 | 0.4.3 | patch |
| plug_cowboy | 2.7.5 | 2.8.0 | minor (transitive) |
| protobuf | 0.15.0 | 0.16.0 | minor (transitive) |
| req | 0.5.16 | 0.5.17 | patch |
| telemetry | 1.3.0 | 1.4.1 | minor |

## Breaking Changes

**Plug 1.18.1 → 1.19.1**: The `owner` field on `Plug.Conn` is now deprecated and defaults to `nil` instead of `self()`. Fixed one test in `serve_shape_plug_test.exs` that relied on `conn.owner` — changed to use `task.pid` instead.

## Verification

- [x] `mix compile --warnings-as-errors` — passes for all three packages
- [x] `mix format --check-formatted` — passes for all three packages
- [x] `mix hex.outdated` — all deps now show "Up-to-date"
- [x] `mix test` — passes for all three packages (some pre-existing flaky tests in sync-service and electric-telemetry, not related to updates)

## Git-pinned Dependencies

No git-pinned dependencies found in any of the three packages.
