defmodule Electric.PostgresServer do
  def child_spec(opts) do
    opts = [inet_backend: :socket, port: Keyword.fetch!(opts, :port)]

    :ranch.child_spec(
      __MODULE__,
      :ranch_tcp,
      opts,
      Electric.Replication.Postgres.TcpServer,
      []
    )
  end
end
