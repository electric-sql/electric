defmodule ElectricTest.SetupHelpers do
  @moduledoc """
  Different useful functions and setup helper
  """
  use Electric.Satellite.Protobuf
  import ExUnit.Callbacks
  import ExUnit.Assertions

  @doc """
  Starts SchemaCache process with a given origin, and
  immediately fills it from given SQL.
  """
  def start_schema_cache(origin \\ "fake_origin", backend_opts) do
    backend = Electric.Postgres.MockSchemaLoader.backend_spec(backend_opts)

    start_supervised!(
      {Electric.Postgres.Extension.SchemaCache, {[origin: origin], [backend: backend]}}
    )

    [origin: origin]
  end

  @doc """
  Wait for and receives subscription data response as sent back to the test process by `Satellite.TestWsClient`.

  Waits for the `SatSubsDataBegin` message, then for each shape data, then for the end message,
  and verifies their order. Returns a map, where the shape request ids are keys, and the `SatOpInsert` operations are values.
  """
  @spec receive_subscription_data(term(), String.t(), [
          {:timeout, non_neg_integer()} | {:expecting_lsn, String.t()}
        ]) :: %{optional(String.t()) => [%SatOpInsert{}]}
  def receive_subscription_data(conn, subscription_id, opts \\ []) do
    first_message_timeout = Keyword.get(opts, :timeout, 1000)

    receive do
      {^conn, %SatSubsDataBegin{subscription_id: ^subscription_id, lsn: received_lsn}} ->
        case Keyword.fetch(opts, :expecting_lsn) do
          {:ok, expected_lsn} -> assert expected_lsn == received_lsn
          _ -> nil
        end

        receive_rest_of_subscription_data(conn, [])
        |> assert_subscription_data_format(%{})
    after
      first_message_timeout ->
        {:messages, messages} = :erlang.process_info(self(), :messages)

        flunk(
          "Timed out waiting for #{inspect(%SatSubsDataBegin{subscription_id: subscription_id})} after #{first_message_timeout} ms.\n\nCurrent messages: #{inspect(messages, pretty: true)}"
        )
    end
  end

  defp receive_rest_of_subscription_data(conn, acc) do
    receive do
      {^conn, %SatSubsDataEnd{}} ->
        Enum.reverse(acc)

      {_, %type{} = msg}
      when type in [SatOpLog, SatShapeDataBegin, SatShapeDataEnd] ->
        receive_rest_of_subscription_data(conn, [msg | acc])
    after
      100 ->
        flunk(
          "Timeout while waiting for message sequence responding to a subscription, received:\n#{inspect(acc, pretty: true)}"
        )
    end
  end

  defp assert_subscription_data_format([], acc), do: acc

  defp assert_subscription_data_format(messages, acc) do
    assert [%SatShapeDataBegin{request_id: id} | messages] = messages
    {oplogs, messages} = Enum.split_while(messages, &match?(%SatOpLog{}, &1))

    oplogs =
      oplogs
      |> Enum.flat_map(& &1.ops)
      |> Enum.map(fn op ->
        assert %SatTransOp{op: {:insert, %SatOpInsert{} = insert}} = op,
               "Expected only SatOpInsert operations to be in the OpLog messages"

        insert
      end)

    assert [%SatShapeDataEnd{} | messages] = messages

    assert_subscription_data_format(messages, Map.put(acc, id, oplogs))
  end
end
