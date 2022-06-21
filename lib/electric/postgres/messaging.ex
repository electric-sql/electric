defmodule Electric.Postgres.Messaging do
  @moduledoc """
  Build binary messages in the postgres communication protocol
  """

  alias Electric.Postgres.LogicalReplication.OidDatabase

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
    |> then(fn x -> Enum.reduce(data, x, &data_row(&2, &1)) end)
    |> command_complete(command)
    |> ready()
  end

  def row_description(prev \\ "", fields) when is_list(fields) do
    data =
      for {field_name, attrs} <- fields, into: <<length(fields)::16>> do
        table_oid = Keyword.get(attrs, :table_oid, 0)
        column_attr = Keyword.get(attrs, :column_attr, 0)
        {type_oid, type_size, type_mod} = get_type_information(Keyword.fetch!(attrs, :type))

        <<str(field_name)::binary, table_oid::32, column_attr::16, type_oid::32, type_size::16,
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

  def data_row(prev \\ "", data)
  def data_row(prev, data) when is_tuple(data), do: data_row(prev, Tuple.to_list(data))

  def data_row(prev, data) when is_list(data) do
    data
    |> Enum.into(<<length(data)::16>>, fn
      nil -> <<-1::32>>
      x when is_binary(x) -> <<byte_size(x)::32, x::binary>>
    end)
    |> then(&(prev <> tagged_message(?D, &1)))
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
end
