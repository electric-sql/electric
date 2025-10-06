defmodule Electric.Replication.Eval do
  @moduledoc """
  Utilities for evaluating and converting replication-related types.
  """

  @doc """
  Converts a type specification to a PostgreSQL cast string.

  ## Parameters

    - `type` - A type specification, which can be:
      - An atom representing a basic PostgreSQL type
      - A tuple `{:array, type}` for array types
      - A tuple `{:enum, name}` for enum types

  ## Returns

  A string representation of the PostgreSQL cast type.

  ## Examples

  Basic types:

      iex> Electric.Replication.Eval.type_to_pg_cast(:int4)
      "int4"

      iex> Electric.Replication.Eval.type_to_pg_cast(:text)
      "text"

      iex> Electric.Replication.Eval.type_to_pg_cast(:bool)
      "bool"

  Array types:

      iex> Electric.Replication.Eval.type_to_pg_cast({:array, :int4})
      "int4[]"

      iex> Electric.Replication.Eval.type_to_pg_cast({:array, :text})
      "text[]"

  Nested array types:

      iex> Electric.Replication.Eval.type_to_pg_cast({:array, {:array, :int4}})
      "int4[]"

  Enum types:

      iex> Electric.Replication.Eval.type_to_pg_cast({:enum, :my_enum})
      "my_enum"

      iex> Electric.Replication.Eval.type_to_pg_cast({:enum, "custom_enum"})
      "custom_enum"

  Unsupported types raise errors:

      iex> Electric.Replication.Eval.type_to_pg_cast({:row, []})
      ** (RuntimeError) Unsupported type: row

      iex> Electric.Replication.Eval.type_to_pg_cast({:internal, :something})
      ** (RuntimeError) Unsupported type: internal
  """
  def type_to_pg_cast(type, is_in_array? \\ false)
  def type_to_pg_cast({:array, type}, true), do: "#{type_to_pg_cast(type, true)}"
  def type_to_pg_cast({:array, type}, false), do: "#{type_to_pg_cast(type, true)}[]"
  def type_to_pg_cast({:enum, name}, _), do: to_string(name)
  def type_to_pg_cast({:row, _}, _), do: raise("Unsupported type: row")
  def type_to_pg_cast({:internal, _}, _), do: raise("Unsupported type: internal")
  def type_to_pg_cast(type, _) when is_atom(type), do: to_string(type)
end
