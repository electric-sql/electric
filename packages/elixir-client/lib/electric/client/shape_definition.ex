defmodule Electric.Client.ShapeDefinition do
  @moduledoc """
  Struct for defining a shape.

      iex> ShapeDefinition.new("items", where: "something = true")
      {:ok, %ShapeDefinition{table: "items", where: "something = true"}}
  """

  alias Electric.Client.Util

  @public_keys [:namespace, :table, :columns, :where, :params]
  @derive {Jason.Encoder, only: @public_keys}
  @enforce_keys [:table]

  defstruct @public_keys ++ [parser: {Electric.Client.ValueMapper, []}]

  # only allow things that are trivially convertable to strings
  @params_types {:or, [:string, :integer, :float, :boolean]}

  @schema_opts [
    where: [
      type: {:or, [nil, :string]},
      required: false,
      default: nil,
      doc: "Filter the table according to the where clause."
    ],
    columns: [
      type: {:or, [nil, {:list, :string}]},
      default: nil,
      doc:
        "List of columns to include in the shape. Must include all primary keys. If `nil` this is equivalent to all columns (`SELECT *`)"
    ],
    namespace: [
      type: {:or, [nil, :string]},
      required: false,
      default: nil,
      doc:
        "The namespace the table belongs to. If `nil` then Postgres will use whatever schema is the default (usually `public`)."
    ],
    params: [
      type: {:or, [nil, {:map, :pos_integer, @params_types}, {:list, @params_types}]},
      default: nil,
      doc:
        "Values of positional parameters in the where clause. These will substitute `$i` placeholder in the where clause."
    ],
    parser: [
      type: :mod_arg,
      default: {Electric.Client.ValueMapper, []},
      doc: """
      A `{module, args}` tuple specifying the `Electric.Client.ValueMapper`
      implementation to use for mapping values from the sync stream into Elixir
      terms.
      """
    ]
  ]
  @schema NimbleOptions.new!(@schema_opts)

  @type t :: %__MODULE__{
          namespace: String.t() | nil,
          table: String.t(),
          columns: [String.t(), ...] | nil,
          where: nil | String.t(),
          parser: {atom(), term()}
        }

  @type option :: unquote(NimbleOptions.option_typespec(@schema))
  @type options :: [option()]

  @doc false
  def schema_definition, do: @schema_opts

  @spec new(String.t() | keyword()) :: {:ok, t()} | {:error, term()}
  def new(table_name) when is_binary(table_name) do
    new(table_name, [])
  end

  def new(opts) when is_list(opts) do
    {table, opts} = Keyword.pop(opts, :table, nil)
    new(table, opts)
  end

  @doc """
  Create a `ShapeDefinition` for the given `table_name`.

  ## Options

  #{NimbleOptions.docs(@schema)}
  """
  @spec new(String.t(), options()) :: {:ok, t()} | {:error, term()}
  def new(table_name, opts) when is_binary(table_name) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      {:ok,
       %__MODULE__{
         table: table_name,
         where: Access.get(opts, :where),
         columns: Access.get(opts, :columns),
         namespace: Access.get(opts, :namespace),
         parser: Access.get(opts, :parser),
         params: Access.get(opts, :params)
       }}
    end
  end

  @spec new!(String.t(), options()) :: t() | no_return()
  def new!(table_name, opts \\ []) do
    case new(table_name, opts) do
      {:ok, shape} -> shape
      {:error, %NimbleOptions.ValidationError{} = error} -> raise error
    end
  end

  def public_keys, do: @public_keys

  @doc """
  Return a string representation of the shape's table, quoted for use in API URLs.

      iex> ShapeDefinition.url_table_name(ShapeDefinition.new!("my_table"))
      "my_table"

      iex> ShapeDefinition.url_table_name(ShapeDefinition.new!("my_table", namespace: "my_app"))
      "my_app.my_table"

      iex> ShapeDefinition.url_table_name(ShapeDefinition.new!("my table", namespace: "my app"))
      ~s["my app"."my table"]

  """
  @spec url_table_name(t()) :: String.t()
  def url_table_name(%__MODULE__{namespace: nil, table: table}) do
    safe_url_name(table)
  end

  def url_table_name(%__MODULE__{namespace: namespace, table: table}) do
    url_table_name(namespace, table)
  end

  def url_table_name(namespace, table) do
    IO.iodata_to_binary([safe_url_name(namespace), ".", safe_url_name(table)])
  end

  defp safe_url_name(name) do
    if name =~ ~r/^[a-z_][a-z0-9_]*$/ do
      name
    else
      quote_table_name(name)
    end
  end

  defp quote_table_name(name) do
    IO.iodata_to_binary([
      ?",
      :binary.replace(name, ~s["], ~s[""], [:global]),
      ?"
    ])
  end

  @doc """
  Tests if two `%ShapeDefinition{}` instances are equal, ignoring the `parser`
  setting.

  ## Example

      iex> {:ok, shape1} = Electric.Client.ShapeDefinition.new("items")
      iex> {:ok, shape2} = Electric.Client.ShapeDefinition.new("items")
      iex> Electric.Client.ShapeDefinition.matches?(shape1, shape2)
      true
      iex> {:ok, shape3} = Electric.Client.ShapeDefinition.new("items", where: "something = 'here'")
      iex> Electric.Client.ShapeDefinition.matches?(shape1, shape3)
      false
  """
  @spec matches?(t(), t()) :: boolean()
  def matches?(%__MODULE__{} = shape1, %__MODULE__{} = shape2) do
    Map.take(shape1, @public_keys) == Map.take(shape2, @public_keys)
  end

  def matches?(_term1, _term2), do: false

  @doc false
  @spec params(t(), [{:format, :query | :json}]) :: Electric.Client.Fetch.Request.params()
  def params(%__MODULE__{} = shape, opts \\ []) do
    %{where: where, columns: columns, params: params} = shape
    table_name = url_table_name(shape)
    format = Keyword.get(opts, :format, :query)

    %{table: table_name}
    |> Util.map_put_if(:where, where, is_binary(where))
    |> Util.map_put_if(
      :columns,
      fn -> params_columns_list(columns, format) end,
      is_list(columns)
    )
    |> maybe_add_where_params(:params, params, format)
    |> normalize_keys(format)
  end

  defp params_columns_list(columns, :query) when is_list(columns) do
    Enum.join(columns, ",")
  end

  defp params_columns_list(columns, :json) when is_list(columns) do
    columns
  end

  defp maybe_add_where_params(input, _, nil, _), do: input

  defp maybe_add_where_params(input, key, params, format) do
    params
    |> normalize_params_form()
    |> then(&put_param_map(input, key, &1, format))
  end

  defp normalize_params_form(params) when is_list(params) do
    params
    |> Enum.with_index(fn elem, index -> {to_string(index + 1), to_string(elem)} end)
    |> Map.new()
  end

  defp normalize_params_form(params) when is_map(params) do
    Map.new(params, fn {k, v} -> {to_string(k), to_string(v)} end)
  end

  defp put_param_map(input, key, params, :query) do
    params
    |> Map.new(fn {k, v} -> {"#{key}[#{k}]", v} end)
    |> Map.merge(input)
  end

  defp put_param_map(input, key, params, :json) do
    Map.put(input, key, params)
  end

  defp normalize_keys(params, :query) do
    Map.new(params, fn {k, v} -> {to_string(k), v} end)
  end

  defp normalize_keys(params, :json) do
    params
  end
end
