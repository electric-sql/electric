defmodule Electric.Replication.PostgresClient do
  @moduledoc """
  Postgres database replication client.

  Uses `:epgsql` for it's `start_replication` function. Note that epgsql
  doesn't support connecting via a unix socket.
  """

  @doc """
  Invoke to connect to a Postgres instance and start logical replication

  On success returns the established connection, so that it can be used to acknowledge LSNs
  """
  @callback connect_and_start_replication(handler_process :: pid()) ::
              {:ok, term()} | {:error, :epgsql.connect_error() | :epgsql.query_error()}
  @callback connect_and_start_replication(handler_process :: pid(), config_overrides :: map()) ::
              {:ok, term()} | {:error, :epgsql.connect_error() | :epgsql.query_error()}

  @doc """
  Acknowledge that the LSN has been processed
  """
  @callback acknowledge_lsn(connection :: term(), lsn :: %{segment: integer(), offset: integer()}) ::
              :ok

  def connect_and_start_replication(handler, config_overrides \\ []) do
    config = Application.fetch_env!(:electric, __MODULE__)

    connection_config =
      config
      |> Keyword.get(:connection, [])
      |> Map.new()
      |> Map.merge(Map.new(Keyword.get(config_overrides, :connection, [])))

    %{slot: slot, publication: publication} =
      config
      |> Keyword.get(:replication, [])
      |> Map.new()
      |> Map.merge(Map.new(Keyword.get(config_overrides, :replication, [])))

    opts = 'proto_version \'1\', publication_names \'#{publication}\''

    with {:ok, conn} <- :epgsql.connect(connection_config),
         :ok <- :epgsql.start_replication(conn, slot, handler, [], '0/0', opts) do
      {:ok, conn}
    end
  end

  def connect(%{} = config) do
    :epgsql.connect(config)
  end

  @doc """
  Start consuming logical replication feed using a given `publication` and `slot`.

  The handler can be a pid or a module implementing the `handle_x_log_data` callback.

  Returns `:ok` on success.
  """
  def start_replication(conn, publication, slot, handler) do
    opts = 'proto_version \'1\', publication_names \'#{publication}\''

    conn
    |> :epgsql.start_replication(slot, handler, [], '0/0', opts)
  end

  @doc """
  Confirm successful processing of a WAL segment.

  Returns `:ok` on success.
  """
  def acknowledge_lsn(conn, %{segment: segment, offset: offset}) do
    <<decimal_lsn::integer-64>> = <<segment::integer-32, offset::integer-32>>

    :epgsql.standby_status_update(conn, decimal_lsn, decimal_lsn)
  end
end
