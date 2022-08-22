defmodule Electric.PostgresServer do
  def child_spec(_opts) do
    opts = [inet_backend: :socket, port: 5433]

    :ranch.child_spec(
      __MODULE__,
      :ranch_tcp,
      opts,
      Electric.Replication.Postgres.TcpServer,
      []
    )
  end
end
