defmodule Electric.ServiceStatus do
  @type status() :: :starting | :ready | :active | :stopping

  @type opts() ::
          Keyword.t(get_replication_status: (-> Electric.Postgres.ReplicationClient.status()))

  @spec check(opts()) :: status()
  def check(opts) do
    with replication_status <- opts.get_replication_status.() do
      case replication_status do
        :starting -> :starting
        :waiting -> :ready
        :active -> :active
      end
    end
  end
end
