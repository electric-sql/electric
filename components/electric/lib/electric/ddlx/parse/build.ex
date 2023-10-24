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
end
