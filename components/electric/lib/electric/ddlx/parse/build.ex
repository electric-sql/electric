defmodule Electric.DDLX.Parse.Build do
  def default_schema(opts) do
    Keyword.get(opts, :default_schema, "public")
  end

  def fetch_attr(params, name, default) do
    {:ok, Keyword.get(params, name, default)}
  end

  def fetch_attr(params, name) do
    case Keyword.fetch(params, name) do
      {:ok, value} -> {:ok, value}
      :error -> {:error, "missing #{name} attribute"}
    end
  end

  def attrs_equal(name1, value1, name2, value2) do
    if value1 == value2 do
      {:ok, value1}
    else
      {:error,
       "#{name1} must equal #{name2}: got #{name1}: #{inspect(value1)} #{name2}: #{inspect(value2)}"}
    end
  end

  def split_role_def(role_def, opts) do
    # TODO: validate that none of these are the empty string
    case String.split(role_def, ":", parts: 2) do
      [scope, role] ->
        if blank?(scope) || blank?(role) do
          {:error, "invalid role assignment #{inspect(role_def)}"}
        else
          {:ok, scope} = Electric.Postgres.NameParser.parse(scope, opts)
          {:ok, scope: scope, role_name: role}
        end

      [role] ->
        if blank?(role) do
          {:error, "invalid role assignment #{inspect(role_def)}"}
        else
          {:ok, scope: nil, role_name: role}
        end
    end
  end

  defp blank?(s) when s in [""], do: true
  defp blank?(_), do: false

  def validate_role_information(params, user_table_schema, user_table_name, opts) do
    # we must have a {role_table_name, role_column}
    # if the role_name is null then we must have role_table_name and role_column and
    # {role_table_schema, role_table_name} == {user_table_schema, user_table_name}
    # if the role name is not null, then we should split it at ":" to get a scope
    with {:ok, role_name} <- fetch_attr(params, :role_name),
         {:ok, attrs} <- split_role_def(role_name, opts) do
      {:ok, attrs}
    else
      _ ->
        validate_dynamic_role(params, user_table_schema, user_table_name, opts)
    end
  end

  def validate_dynamic_role(params, user_table_schema, user_table_name, opts) do
    with {:ok, role_table_schema} <- fetch_attr(params, :role_table_schema, default_schema(opts)),
         {:ok, role_table_name} <- fetch_attr(params, :role_table_name),
         {:ok, role_column} <- fetch_attr(params, :role_table_column),
         # This is based on the assumption that the dynamic role value *MUST* come from the same table
         # as the user id
         {:ok, schema_name} <-
           attrs_equal(
             :role_table_schema,
             role_table_schema,
             :user_table_schema,
             user_table_schema
           ),
         {:ok, table_name} <-
           attrs_equal(:role_table_name, role_table_name, :user_table_name, user_table_name) do
      {:ok, role_table: {role_table_schema, role_table_name}, role_column: role_column}
    end
  end

  def validate_scope_information(params, opts) do
    with {:ok, scope_schema_name} <- fetch_attr(params, :scope_schema_name, default_schema(opts)),
         {:ok, scope_table_name} <- fetch_attr(params, :scope_table_name) do
      {:ok, scope: {scope_schema_name, scope_table_name}}
    else
      _ -> {:ok, []}
    end
  end
end
