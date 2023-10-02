defmodule Electric.Postgres.Proxy.Injector.TransparentTest do
  use ExUnit.Case, async: true

  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Injector.Transparent

  import Electric.Postgres.Proxy.TestScenario

  setup do
    {:ok, injector} = Transparent.injector()
    {:ok, injector: injector}
  end

  test "forwards everything from the client to the server", cxt do
    cxt.injector
    |> client(begin())
    |> server(complete_ready("BEGIN", :tx))
    |> client(parse_describe("SELECT * FROM something"))
    |> server(parse_describe_complete())
    |> client(bind_execute())
    |> server(bind_execute_complete())
    |> client(commit())
    |> server(complete_ready("COMMIT", :idle))
    |> idle!(Transparent)
  end
end
