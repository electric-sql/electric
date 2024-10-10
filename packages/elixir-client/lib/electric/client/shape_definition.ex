defmodule Electric.Client.ShapeDefinition do
  @moduledoc """
  Struct for defining a shape.

      iex> ShapeDefinition.new("items", where: "something = true")
      %ShapeDefinition{table: "items", where: "something = true"}
  """

  @enforce_keys [:table]

  defstruct [:namespace, :table, :where]

  @schema NimbleOptions.new!(
            where: [
              type: {:or, [nil, :string]},
              required: false,
              default: nil,
              doc: "Filter the table according to the where clause."
            ],
            namespace: [
              type: {:or, [nil, :string]},
              required: false,
              default: nil,
              doc:
                "The namespace the table belongs to. If `nil` then Postgres will use whatever schema is the default (usually `public`)."
            ]
          )

  @type t :: %__MODULE__{
          namespace: String.t() | nil,
          table: String.t(),
          where: nil | String.t()
        }

  @type option :: unquote(NimbleOptions.option_typespec(@schema))
  @type options :: [option()]

  @quot "%22"

  @spec new(String.t(), options()) :: t()
  @doc """
  Create a `ShapeDefinition` for the given `table_name`.

  ## Options

  #{NimbleOptions.docs(@schema)}
  """
  def new(table_name, opts \\ []) do
    opts = NimbleOptions.validate!(opts, @schema)

    %__MODULE__{
      table: table_name,
      where: Keyword.get(opts, :where),
      namespace: Keyword.get(opts, :namespace)
    }
  end

  @doc """
  Return a string representation of the shape's table, quoted for use in API URLs.

      iex> ShapeDefinition.url_table_name(ShapeDefinition.new("my_table"))
      "my_table"

      iex> ShapeDefinition.url_table_name(ShapeDefinition.new("my_table", namespace: "my_app"))
      "my_app.my_table"

      iex> ShapeDefinition.url_table_name(ShapeDefinition.new("my table", namespace: "my app"))
      "%22my app%22.%22my table%22"

  """
  @spec url_table_name(t()) :: String.t()
  def url_table_name(%__MODULE__{namespace: nil, table: name}) do
    safe_url_name(name)
  end

  def url_table_name(%__MODULE__{namespace: namespace, table: name}) do
    IO.iodata_to_binary([safe_url_name(namespace), ".", safe_url_name(name)])
  end

  defp safe_url_name(name) do
    if name =~ ~r/^[a-z0-9_]+$/ do
      name
    else
      quote_table_name(name)
    end
  end

  defp quote_table_name(name) do
    IO.iodata_to_binary([
      @quot,
      :binary.replace(name, ~s["], ~s[#{@quot}#{@quot}], [:global]),
      @quot
    ])
  end
end
