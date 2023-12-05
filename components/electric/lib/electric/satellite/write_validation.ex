defmodule Electric.Satellite.WriteValidation do
  alias Electric.Satellite.WriteValidation
  alias Electric.Replication.Changes
  alias Electric.Postgres.Extension.SchemaLoader

  @type result() :: :ok | {:error, Changes.change(), String.t()}
  @type allowed_result() :: :ok | {:error, reason :: String.t()}
  @type txns() :: [Changes.Transaction.t()]

  @type insert() :: Changes.NewRecord.t()
  @type update() :: Changes.UpdatedRecord.t()
  @type delete() :: Changes.DeletedRecord.t()

  @callback validate_insert(insert(), SchemaLoader.Version.t()) :: allowed_result()
  @callback validate_update(update(), SchemaLoader.Version.t()) :: allowed_result()
  @callback validate_delete(delete(), SchemaLoader.Version.t()) :: allowed_result()

  defmodule Error do
    defstruct [:tx, :reason, :verifier, :change]

    @type t() :: %__MODULE__{
            tx: Changes.Transaction.t(),
            reason: String.t(),
            verifier: module(),
            change: Changes.change()
          }

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

      def validate_insert(_, _), do: :ok
      def validate_update(_, _), do: :ok
      def validate_delete(_, _), do: :ok

      defoverridable validate_insert: 2, validate_update: 2, validate_delete: 2
    end
  end

  @spec validate_transactions!(txns(), SchemaLoader.t()) ::
          {:ok, txns()} | {:error, term()} | {:error, txns(), Error.t(), txns()}
  def validate_transactions!(txns, schema_loader) do
    with {:ok, schema_version} <- SchemaLoader.load(schema_loader) do
      split_ok(txns, &is_valid_tx?(&1, schema_version), [])
    end
  end

  @spec is_valid_tx?(Changes.Transaction.t(), SchemaLoader.Version.t()) ::
          :ok | {:error, Error.t()}
  defp is_valid_tx?(%Changes.Transaction{changes: changes} = tx, schema_version) do
    all_ok?(changes, &is_valid_change?(&1, schema_version), fn _src, error ->
      {:error, %{error | tx: tx}}
    end)
  end

  defp is_valid_change?(op, schema_version) do
    all_ok?(
      @validations,
      validation_function(op, schema_version),
      &validation_error(&1, &2, op)
    )
  end

  defp validation_function(op, schema_version) do
    case op do
      %Changes.NewRecord{} -> & &1.validate_insert(op, schema_version)
      %Changes.UpdatedRecord{} -> & &1.validate_update(op, schema_version)
      %Changes.DeletedRecord{} -> & &1.validate_delete(op, schema_version)
      # ignore compensation messages
      %Changes.Compensation{} -> fn _ -> :ok end
    end
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

  @spec split_ok(txns(), (Changes.Transaction.t() -> :ok | {:error, Error.t()}), txns()) ::
          {:ok, txns()} | {:error, txns(), Error.t(), txns()}
  defp split_ok([tx | tail], fun, acc) do
    case fun.(tx) do
      :ok ->
        split_ok(tail, fun, [tx | acc])

      {:error, error} ->
        {:error, :lists.reverse(acc), error, tail}
    end
  end

  defp split_ok([], _, acc) do
    {:ok, :lists.reverse(acc)}
  end
end
