defmodule Electric.Postgres.Schema.Validator do
  alias Electric.Postgres.NameParser
  alias Electric.Satellite.SatPerms
  alias Electric.Postgres
  alias Electric.Postgres.Proxy
  alias Electric.Postgres.Schema
  alias Electric.Postgres.Schema.Proto

  @write_privs Electric.Satellite.Permissions.write_privileges()
  @allowed_write_constraints [:primary, :not_null, :foreign]
  @valid_pk_types Postgres.supported_pk_types()

  @type partial_error() :: %{
          required(:message) => String.t(),
          optional(:code) => String.t(),
          optional(:detail) => String.t(),
          optional(:schema) => Postgres.name(),
          optional(:table) => Postgres.name()
        }
  @type ok_warnings() :: {:ok, [String.t()]}
  @type error() :: {:error, partial_error()}

  @valid_types_read MapSet.new(Postgres.supported_types_read_only())
  @valid_types_write MapSet.new(Postgres.supported_types())

  @spec validate_column_type(%Proto.Column.Type{}, readonly: boolean()) ::
          :ok | {:error, String.t()}
  def validate_column_type(%Proto.Column.Type{size: [], array: []} = type, readonly: readonly) do
    valid_types =
      if readonly,
        do: @valid_types_read,
        else: @valid_types_write

    if type.name in valid_types do
      :ok
    else
      invalid_type(type)
    end
  end

  def validate_column_type(%Proto.Column.Type{} = type, readonly: _readonly) do
    invalid_type(type)
  end

  defp invalid_type(%Proto.Column.Type{} = type) do
    {:error, Electric.Postgres.Dialect.Postgresql.map_type(type)}
  end

  @doc """
  Check that the schema for the given table is suitable for electrification.

  Currently checks 3 things:

  1. That the table is in the `public` namespace
  2. That the table has a defined primary key
  3. That all the column types are supported by Electric (end-to-end)

  Deeper checks around constraints and the type of the primary key are done when granting
  permissions, see `validate_schema_for_permissions/2` below.

  TODO: the signature for a valid schema is `{:ok, warnings}` where `warnings` is a list of
  warning messages about potential issues with the table schema that you might hit later, e.g.
  when granting write permissions. This warnings implementation hasn't been done yet.
  """
  # NOTE: Rather than passing a full schema here, we only receive a partial one with just the
  # definition of the table being electrified. This is because we have no way of retrieving
  # a consistent view of the latest schema without a lot of work. Basically we'd have to move
  # the updating of the schema out of the replication stream handling and into the proxy itself,
  # then we'd know that the schema in pg was up-to-date and could load it within the 
  # migration operation.
  @spec validate_schema_for_electrification(Postgres.Schema.t(), Postgres.relation(), MapSet.t()) ::
          ok_warnings() | error()
  def validate_schema_for_electrification(schema, {_, _} = relation, electrified) do
    case relation do
      {"public", _} ->
        {:ok, table_schema} = Schema.fetch_table(schema, relation)

        with {:ok, warnings} <- ensure_has_primary_key(table_schema, relation, []),
             {:ok, warnings} <-
               ensure_column_types(table_schema, schema.enums, relation, warnings),
             {:ok, warnings} <-
               ensure_fk_destinations(table_schema, electrified, warnings) do
          {:ok, warnings}
        end

      {_invalid, _} ->
        {:error, Proxy.Errors.invalid_table_schema(relation)}
    end
  end

  defp ensure_has_primary_key(table_schema, relation, warnings) do
    case fetch_constraint(table_schema.constraints, :primary) do
      {:ok, _} -> {:ok, warnings}
      :error -> {:error, Proxy.Errors.no_primary_key(relation)}
    end
  end

  defp ensure_column_types(table_schema, enums, _relation, warnings) do
    enum_types =
      Map.new(enums, fn %{name: %{name: ename, schema: sname}, values: values} ->
        {{sname, ename}, values}
      end)

    Enum.reduce_while(table_schema.columns, {:ok, warnings}, fn
      %Proto.Column{type: type} = column, {:ok, warnings} ->
        case validate_column_type(type, readonly: true) do
          :ok ->
            warnings =
              case validate_column_type(type, readonly: false) do
                :ok ->
                  warnings

                {:error, type_name} ->
                  ["Column #{inspect(column.name)} #{type_name} is read-only" | warnings]
              end

            {:cont, {:ok, warnings}}

          {:error, type_name} ->
            # not a valid known type, so validate against defined enums
            {:ok, {_, _} = enum} = NameParser.parse(type.name)

            with {:enum, {:ok, values}} <- {:enum, Map.fetch(enum_types, enum)},
                 {:ok, warnings} <- validate_enum(enum, values, warnings) do
              {:cont, {:ok, warnings}}
            else
              {:enum, :error} ->
                {:halt, {:error, Proxy.Errors.cannot_electrify_column_type(type_name)}}

              {:error, _} = error ->
                {:halt, error}
            end
        end
    end)
  end

  @valid_enum_re ~r/^[a-zA-Z][a-zA-Z_0-9]*$/

  defp validate_enum(name, values, warnings) do
    Enum.reduce_while(values, {:ok, warnings}, fn value, {:ok, warnings} ->
      if Regex.match?(@valid_enum_re, value) do
        {:cont, {:ok, warnings}}
      else
        {:halt, {:error, Proxy.Errors.invalid_enum(name, [value])}}
      end
    end)
  end

  defp ensure_fk_destinations(table_schema, electrified, warnings) do
    Enum.reduce_while(table_schema.constraints, {:ok, warnings}, fn
      %{constraint: {:foreign, %{pk_table: target}}}, {:ok, warnings} ->
        %{schema: sname, name: tname} = target

        if MapSet.member?(electrified, {sname, tname}) do
          {:cont, {:ok, warnings}}
        else
          {:halt, {:error, Proxy.Errors.missing_reference(table_schema.name, {sname, tname})}}
        end

      _, {:ok, warnings} ->
        {:cont, {:ok, warnings}}
    end)
  end

  @doc """
  Validates a table against a set of permission GRANTs to check that the permissions being
  granted are compatible with the table schema.

  For instance, it's perfectly ok to grant `READ` permissions on a table with a `UNIQUE`
  constraint on one of its columns, because in that case writes will only come via Postgres, which
  will validate the constraints immediately.

  But you can't grant any write-level permissions against the same table because the unique
  constraint cannot be guaranteed with eventually-consistent writes from the clients.

  TODO: the signature for a valid schema is `{:ok, warnings}` where `warnings` is a list of
  warning messages about potential issues with the table schema that you might hit later, e.g.
  when granting write permissions. This warnings implementation hasn't been done yet.
  """
  @spec validate_schema_for_permissions(
          Postgres.Schema.t(),
          %SatPerms.DDLX{} | %SatPerms.Rules{} | %{grants: [%SatPerms.Grant{}]}
        ) :: ok_warnings() | error()
  def validate_schema_for_permissions(schema, %{grants: grants}) do
    Enum.reduce_while(grants, {:ok, []}, &validate_grant(&1, &2, schema))
  end

  @spec validate_schema_for_permissions(Postgres.Schema.t(), %SatPerms.Grant{}) ::
          ok_warnings() | error()
  def validate_schema_for_grant(schema, %SatPerms.Grant{} = grant) do
    validate_schema_for_permissions(schema, %{grants: [grant]})
  end

  defp validate_grant(%SatPerms.Grant{privilege: privilege} = grant, {:ok, warnings}, schema) do
    schema
    |> Schema.fetch_table!(grant.table)
    |> validate_table_for(privilege, warnings)
  end

  defp validate_table_for(table_schema, privilege, warnings) when privilege in @write_privs do
    with {:ok, warnings} <- validate_primary_keys(table_schema, warnings, privilege),
         {:ok, warnings} <- validate_column_defaults(table_schema, warnings, privilege),
         {:ok, warnings} <- validate_constraints(table_schema, warnings, privilege) do
      {:cont, {:ok, warnings}}
    else
      {:error, _} = error ->
        {:halt, error}
    end
  end

  defp validate_table_for(_table_schema, _privilege, warnings) do
    {:cont, {:ok, warnings}}
  end

  defp validate_primary_keys(table_schema, warnings, :INSERT) do
    case fetch_constraint(table_schema.constraints, :primary) do
      {:ok, %Proto.Constraint.PrimaryKey{} = pk} ->
        Enum.reduce_while(pk.keys, {:ok, warnings}, fn column_name, {:ok, warnings} ->
          case fetch_column(table_schema, column_name) do
            {:ok, %Proto.Column{type: %{name: valid}}} when valid in @valid_pk_types ->
              {:cont, {:ok, warnings}}

            {:ok, %Proto.Column{type: %Proto.Column.Type{name: invalid}}} ->
              {:halt,
               {:error,
                Proxy.Errors.cannot_grant_write_permissions(
                  table_schema.name,
                  "Primary key #{inspect(column_name)} is of type #{inspect(invalid)}. Only types #{quoted_list(@valid_pk_types)} are supported"
                )}}

            :error ->
              raise "Couldn't find column #{inspect(column_name)} in table #{inspect(table_schema.name)}"
          end
        end)

      :error ->
        {:error,
         Proxy.Errors.cannot_grant_write_permissions(table_schema.name, "Missing primary key")}
    end
  end

  defp validate_primary_keys(_table_schema, warnings, _privilege) do
    {:ok, warnings}
  end

  defp validate_column_defaults(table_schema, warnings, :INSERT) do
    Enum.reduce_while(table_schema.columns, {:ok, warnings}, fn column, {:ok, warnings} ->
      case fetch_constraint(column.constraints, :default) do
        {:ok, _default_constraint} ->
          {:halt, {:error, Proxy.Errors.cannot_electrify_column_default()}}

        :error ->
          {:cont, {:ok, warnings}}
      end
    end)
  end

  defp validate_column_defaults(_table_schema, warnings, _privilege) do
    {:ok, warnings}
  end

  defp validate_constraints(table_schema, warnings, privilege)
       when privilege in [:INSERT, :UPDATE] do
    Enum.reduce_while(table_schema.constraints, {:ok, warnings}, fn
      %{constraint: {c, _}}, {:ok, warnings} when c in @allowed_write_constraints ->
        {:cont, {:ok, warnings}}

      %{constraint: {:unique, unique}}, {:ok, _warnings} ->
        {:halt, {:error, Proxy.Errors.cannot_electrify_constraint(unique)}}
    end)
  end

  defp validate_constraints(_table_schema, warnings, _privilege) do
    {:ok, warnings}
  end

  defp fetch_column(table_schema, column_name) do
    Enum.find_value(table_schema.columns, :error, fn
      %Proto.Column{name: ^column_name} = column -> {:ok, column}
      _ -> nil
    end)
  end

  defp fetch_constraint(constraints, type) do
    Enum.find_value(constraints, :error, fn
      %{constraint: {^type, constraint}} -> {:ok, constraint}
      _ -> nil
    end)
  end

  defp quoted_list(vars) do
    vars
    |> Enum.map(&inspect/1)
    |> Enum.join(", ")
  end
end
