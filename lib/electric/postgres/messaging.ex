defmodule Electric.Postgres.Messaging do
  @moduledoc """
  Build binary messages in the postgres communication protocol

  It implements only a required subsection of the protocol described
  [in Postgres documentation] (https://www.postgresql.org/docs/current/protocol-message-formats.html),
  and only the backend side (messages marked as `(B)`)
  """

  alias Electric.Postgres.OidDatabase
  alias Electric.Postgres.Lsn

  @error_severity_levels [:error, :fatal, :panic]
  @notice_severity_levels [:warning, :notice, :debug, :info, :log]
  @error_and_notice_field_tags %{
    code: ?C,
    message: ?M,
    detail: ?D,
    hint: ?H
  }

  @type error_and_notice_fields :: [
          code: String.t(),
          message: String.t(),
          detail: String.t(),
          hint: String.t()
        ]

  @spec deny_upgrade_request(binary()) :: binary()
  def deny_upgrade_request(prev \\ ""), do: prev <> "N"

  @spec ready(binary()) :: binary()
  def ready(prev \\ ""), do: prev <> tagged_message(?Z, "I")

  def parameter_status(prev \\ "", name, value)

  def parameter_status(prev, name, value) when is_atom(name),
    do: parameter_status(prev, to_string(name), value)

  def parameter_status(prev, name, value) when is_binary(name) and is_binary(value),
    do: prev <> tagged_message(?S, str(name) <> str(value))

  @spec authentication_ok(binary()) :: binary()
  def authentication_ok(prev \\ ""), do: prev <> tagged_message(?R, <<0::32>>)

  @spec backend_key_data(binary(), binary(), integer()) :: binary()
  def backend_key_data(prev \\ "", pid_binary, secret_key)
      when is_integer(secret_key) and is_binary(pid_binary),
      do: prev <> tagged_message(?K, <<pid_binary::binary, secret_key::32>>)

  def command_complete(prev \\ "", command), do: prev <> tagged_message(?C, str(command))

  def query_response(prev \\ "", command, fields, data) do
    prev
    |> row_description(fields)
    |> data_rows(data)
    |> command_complete(command)
    |> ready()
  end

  def row_description(prev \\ "", fields) when is_list(fields) do
    data =
      for {field_name, attrs_or_type} <- fields, into: <<length(fields)::16>> do
        attrs = if is_list(attrs_or_type), do: attrs_or_type, else: [type: attrs_or_type]
        table_oid = Keyword.get(attrs, :table_oid, 0)
        column_index = Keyword.get(attrs, :column_index, 0)

        {type_oid, type_size, type_mod} = get_type_information(Keyword.fetch!(attrs, :type))

        <<str(field_name)::binary, table_oid::32, column_index::16, type_oid::32, type_size::16,
          type_mod::32, 0::16>>
      end

    prev <> tagged_message(?T, data)
  end

  defp get_type_information(type) when is_atom(type), do: get_type_information({type, -1})

  defp get_type_information({type, modifier}) when is_atom(type) and is_integer(modifier) do
    oid = OidDatabase.oid_for_name(type)
    len = OidDatabase.type_length(oid)
    {oid, len, modifier}
  end

  def data_rows(prev \\ "", rows) do
    Enum.reduce(rows, prev, &data_row(&2, &1))
  end

  def data_row(prev \\ "", data)
  def data_row(prev, data) when is_tuple(data), do: data_row(prev, Tuple.to_list(data))

  def data_row(prev, data) when is_list(data) do
    data
    |> Enum.map(fn
      x when is_binary(x) -> x
      x when is_integer(x) -> to_string(x)
      true -> "t"
      false -> "f"
      nil -> nil
    end)
    |> Enum.into(<<length(data)::16>>, fn
      nil -> <<-1::32>>
      x when is_binary(x) -> <<byte_size(x)::32, x::binary>>
    end)
    |> then(&(prev <> tagged_message(?D, &1)))
  end

  def start_copy_mode(prev \\ ""), do: prev <> tagged_message(?W, <<0::8, 0::16>>)
  def end_copy_mode(prev \\ ""), do: prev <> tagged_message(?c, <<>>)

  def copy_data(prev \\ "", data)
  def copy_data(prev, data) when is_binary(data), do: prev <> tagged_message(?d, data)
  def copy_data(prev, data) when is_list(data), do: Enum.reduce(data, prev, &copy_data(&2, &1))

  def replication_keepalive(prev \\ "", current_lsn)

  def replication_keepalive(prev, %Lsn{} = lsn) do
    replication_keepalive(prev, Lsn.to_integer(lsn))
  end

  def replication_keepalive(prev, wal) when is_integer(wal) do
    clock = timestamp_to_pgtimestamp(DateTime.now!("Etc/UTC"))
    copy_data(prev, <<?k, wal::64, clock::64, 0>>)
  end

  def replication_log(prev \\ "", start_lsn, current_lsn, replication_message)

  def replication_log(prev, start_lsn, current_lsn, replication_message)
      when is_struct(start_lsn),
      do: replication_log(prev, Lsn.to_integer(start_lsn), current_lsn, replication_message)

  def replication_log(prev, start_lsn, current_lsn, replication_message)
      when is_struct(current_lsn),
      do: replication_log(prev, start_lsn, Lsn.to_integer(current_lsn), replication_message)

  def replication_log(prev, start_lsn, current_lsn, replication_message)
      when is_integer(start_lsn) and is_integer(current_lsn) do
    clock = timestamp_to_pgtimestamp(DateTime.now!("Etc/UTC"))
    data = Electric.Postgres.LogicalReplication.encode_message(replication_message)
    copy_data(prev, <<?w, start_lsn::64, current_lsn::64, clock::64, data::binary>>)
  end

  @spec error(binary(), :error | :fatal | :panic, error_and_notice_fields()) :: binary()
  def error(prev \\ "", severity, fields) when severity in @error_severity_levels do
    if not Keyword.has_key?(fields, :code), do: raise(KeyError, key: :code, term: fields)
    if not Keyword.has_key?(fields, :message), do: raise(KeyError, key: :message, term: fields)

    tagged_fields = %{
      ?S => String.upcase(to_string(severity)),
      ?V => String.upcase(to_string(severity))
    }

    fields
    |> Enum.map(fn {k, v} -> {@error_and_notice_field_tags[k], v} end)
    |> Enum.into(tagged_fields)
    |> Enum.map_join(fn {k, v} -> <<k, v::binary, 0>> end)
    |> then(&(prev <> tagged_message(?E, <<&1::binary, 0>>)))
  end

  @spec notice(binary(), :warning | :notice | :debug | :info | :log, error_and_notice_fields()) ::
          binary()
  def notice(prev \\ "", severity, fields) when severity in @notice_severity_levels do
    if not Keyword.has_key?(fields, :code), do: raise(KeyError, key: :code, term: fields)
    if not Keyword.has_key?(fields, :message), do: raise(KeyError, key: :message, term: fields)

    tagged_fields = %{
      ?S => String.upcase(to_string(severity)),
      ?V => String.upcase(to_string(severity))
    }

    fields
    |> Enum.map(fn {k, v} -> {@error_and_notice_field_tags[k], v} end)
    |> Enum.into(tagged_fields)
    |> Enum.map_join(fn {k, v} -> <<k, v::binary, 0>> end)
    |> then(&(prev <> tagged_message(?N, <<&1::binary, 0>>)))
  end

  defp str(data) when is_binary(data), do: <<data::binary, 0>>
  defp str(data) when is_atom(data), do: <<to_string(data)::binary, 0>>

  @spec tagged_message(tag :: non_neg_integer(), data :: binary()) :: binary()
  defp tagged_message(tag, data) when is_integer(tag) do
    <<tag, byte_size(data) + 4::integer-32, data::binary>>
  end

  @pg_epoch DateTime.from_iso8601("2000-01-01T00:00:00.000000Z") |> elem(1)
  defp timestamp_to_pgtimestamp(datetime) when is_struct(datetime, DateTime) do
    DateTime.diff(datetime, @pg_epoch, :microsecond)
  end
end
