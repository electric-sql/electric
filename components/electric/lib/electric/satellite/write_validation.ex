defmodule Electric.Satellite.WriteValidation do
  alias Electric.Satellite.WriteValidation
  alias Electric.Replication.{Changes, Connectors}
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Postgres.Schema

  @type result() :: :ok | {:error, Changes.change(), String.t()}
  @type allowed_result() :: :ok | {:error, reason :: String.t()}

  @type insert() :: Changes.NewRecord.t()
  @type update() :: Changes.UpdatedRecord.t()
  @type delete() :: Changes.DeletedRecord.t()

  @callback is_allowed_insert?(insert(), Schema.t(), SchemaLoader.t()) :: allowed_result()
  @callback is_allowed_update?(update(), Schema.t(), SchemaLoader.t()) :: allowed_result()
  @callback is_allowed_delete?(delete(), Schema.t(), SchemaLoader.t()) :: allowed_result()

  defmodule Error do
    defstruct [:tx, :reason, :verifier, :change]

    def error_response(error) do
      %Electric.Satellite.SatErrorResp{
        error_type: :INVALID_REQUEST,
        lsn: error.tx.lsn,
        message: to_string(error)
      }
    end

    defimpl String.Chars do
      def to_string(error) do
        "Applying transaction [LSN #{error.tx.lsn || "?"}] " <>
          "failed write validation tests for the following reason: " <>
          error.reason <>
          if(error.verifier, do: " (#{verifier_name(error.verifier)})", else: "") <>
          if(error.change, do: " change: #{inspect(error.change)} ", else: "")
      end

      defp verifier_name(module) do
        Module.split(module) |> Enum.at(-1)
      end
    end
  end

  @validations [
    WriteValidation.ImmutablePrimaryKey
  ]

  defmacro __using__(_opts \\ []) do
    quote do
      alias Electric.Replication.Changes.{UpdatedRecord, NewRecord, DeletedRecord}

      @behaviour Electric.Satellite.WriteValidation

      def is_allowed_insert?(_, _, _), do: :ok
      def is_allowed_update?(_, _, _), do: :ok
      def is_allowed_delete?(_, _, _), do: :ok

      defoverridable is_allowed_insert?: 3, is_allowed_update?: 3, is_allowed_delete?: 3
    end
  end

  @spec validate_transactions!([Changes.Transaction.t()], Connectors.origin()) ::
          :ok | no_return()
  def validate_transactions!(txns, schema_loader) do
    {:ok, _version, schema} = SchemaLoader.load(schema_loader)
    split_ok(txns, &is_valid_tx?(&1, schema, schema_loader), [])
  end

  defp is_valid_tx?(%Changes.Transaction{changes: changes} = tx, schema, schema_loader) do
    all_ok?(changes, &is_valid_change?(&1, schema, schema_loader), fn _src, error ->
      {:error, %{error | tx: tx}}
    end)
  end

  # @compile {:inline, is_valid_change?: 3}

  defp is_valid_change?(%Changes.NewRecord{} = insert, schema, schema_loader) do
    all_ok?(
      @validations,
      & &1.is_allowed_insert?(insert, schema, schema_loader),
      &validation_error(&1, &2, insert)
    )
  end

  defp is_valid_change?(%Changes.UpdatedRecord{} = update, schema, schema_loader) do
    all_ok?(
      @validations,
      & &1.is_allowed_update?(update, schema, schema_loader),
      &validation_error(&1, &2, update)
    )
  end

  defp is_valid_change?(%Changes.DeletedRecord{} = delete, schema, schema_loader) do
    all_ok?(
      @validations,
      & &1.is_allowed_delete?(delete, schema, schema_loader),
      &validation_error(&1, &2, delete)
    )
  end

  defp validation_error(validation_module, reason, change) do
    {:error, %Error{reason: reason, verifier: validation_module, change: change}}
  end

  defp all_ok?([], _fun, _error_fun) do
    :ok
  end

  defp all_ok?([c | t], fun, error_fun) do
    case fun.(c) do
      :ok -> all_ok?(t, fun, error_fun)
      {:error, error} -> error_fun.(c, error)
    end
  end

  defp split_ok([tx | tail], fun, acc) do
    case fun.(tx) do
      :ok ->
        split_ok(tail, fun, [tx | acc])

      {:error, error} ->
        # FIXME: return {valid, tx, error, tail} so that we have the tx that were ok
        # the tx that failed and the reason that it failed (plus the tx's after it)
        {:error, :lists.reverse(acc), error, tail}
    end
  end

  defp split_ok([], _, acc) do
    # FIXME: just return a list in the all ok case
    {:ok, :lists.reverse(acc)}
  end
end
