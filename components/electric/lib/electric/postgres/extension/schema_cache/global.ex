defmodule Electric.Postgres.Extension.SchemaCache.Global do
  @moduledoc """
  A wrapper around multiple SchemaCache instances to allow for usage from
  processes that have no concept of a postgres "origin".

  Every SchemaCache instance calls `register/1` but only one succeeds. This
  one instance handles calls to `SchemaCache.Global`.
  """

  alias Electric.Postgres.Extension.SchemaCache

  require Logger

  {:via, :gproc, key} = name = Electric.name(SchemaCache, :__global__)

  @name name
  @key key

  def name, do: @name

  def register(origin) do
    case Electric.reg_or_locate(@name, origin) do
      :ok ->
        # Kept as a warning to remind us that this is wrong... ;)
        Logger.warning("SchemaCache #{inspect(origin)} registered as the global instance")

      {:error, :already_registered, {_pid, registered_origin}} ->
        Logger.warning(
          "Failed to register SchemaCache #{inspect(origin)} as global: #{inspect(registered_origin)} is already registered"
        )
    end
  end

  defp with_instance(timeout \\ 5_000, fun) when is_function(fun, 1) do
    {pid, _value} = :gproc.await(@key, timeout)
    fun.(pid)
  end

  def primary_keys({_schema, _name} = relation) do
    with_instance(fn pid ->
      SchemaCache.primary_keys(pid, relation)
    end)
  end

  def primary_keys(schema, name) when is_binary(schema) and is_binary(name) do
    with_instance(fn pid ->
      SchemaCache.primary_keys(pid, schema, name)
    end)
  end

  def migration_history(version) do
    with_instance(fn pid ->
      SchemaCache.migration_history(pid, version)
    end)
  end

  def known_migration_version?(version) do
    with_instance(fn pid ->
      SchemaCache.known_migration_version?(pid, version)
    end)
  end

  def relation(oid) when is_integer(oid) do
    with_instance(fn pid ->
      SchemaCache.relation(pid, oid)
    end)
  end

  def relation({_schema, _name} = relation) do
    with_instance(fn pid ->
      SchemaCache.relation(pid, relation)
    end)
  end

  def relation({_schema, _name} = relation, version) when is_binary(version) do
    with_instance(fn pid ->
      SchemaCache.relation(pid, relation, version)
    end)
  end

  def relation!(relation) do
    with_instance(fn pid ->
      SchemaCache.relation!(pid, relation)
    end)
  end

  def relation!(relation, version) do
    with_instance(fn pid ->
      SchemaCache.relation!(pid, relation, version)
    end)
  end

  def internal_relation!(relation) do
    with_instance(fn pid ->
      SchemaCache.internal_relation!(pid, relation)
    end)
  end

  def electrified_tables() do
    with_instance(fn pid ->
      SchemaCache.electrified_tables(pid)
    end)
  end
end
