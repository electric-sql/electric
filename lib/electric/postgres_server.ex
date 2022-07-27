defmodule Electric.PostgresServer do
  def child_spec(opts) do
    opts =
      opts
      |> Keyword.put_new(:port, 5433)

    :ranch.child_spec(
      __MODULE__,
      :ranch_tcp,
      opts,
      Electric.Replication.Postgres.TcpServer,
      []
    )
  end
end
