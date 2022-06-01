defmodule Electric.Replication.Client do
  @moduledoc """
  Database replication client.

  Uses `:epgsql` for it's `start_replication` function. Note that epgsql
  doesn't support connecting via a unix socket.
  """

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
  def acknowledge_lsn(conn, {xlog, offset} = _lsn_tup) do
    <<decimal_lsn::integer-64>> = <<xlog::integer-32, offset::integer-32>>

    :epgsql.standby_status_update(conn, decimal_lsn, decimal_lsn)
  end
end
