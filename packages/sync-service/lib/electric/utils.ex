defmodule Electric.Utils do
  @doc """
  Generate a random UUID v4.

  Code taken from Ecto: https://github.com/elixir-ecto/ecto/blob/v3.10.2/lib/ecto/uuid.ex#L174

  ## Examples

      iex> Regex.match?(~r/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, uuid4())
      true
  """
  def uuid4() do
    <<u0::48, _::4, u1::12, _::2, u2::62>> = :crypto.strong_rand_bytes(16)
    encode_uuid(<<u0::48, 4::4, u1::12, 2::2, u2::62>>)
  end

  @doc """
  Encode binary representation of a UUID into a string

  ## Examples

      iex> encode_uuid(<<1, 35, 69, 103, 137, 171, 76, 222, 143, 227, 251, 149, 223, 249, 31, 215>>)
      "01234567-89ab-4cde-8fe3-fb95dff91fd7"
  """
  def encode_uuid(
        <<a1::4, a2::4, a3::4, a4::4, a5::4, a6::4, a7::4, a8::4, b1::4, b2::4, b3::4, b4::4,
          c1::4, c2::4, c3::4, c4::4, d1::4, d2::4, d3::4, d4::4, e1::4, e2::4, e3::4, e4::4,
          e5::4, e6::4, e7::4, e8::4, e9::4, e10::4, e11::4, e12::4>>
      ) do
    <<e(a1), e(a2), e(a3), e(a4), e(a5), e(a6), e(a7), e(a8), ?-, e(b1), e(b2), e(b3), e(b4), ?-,
      e(c1), e(c2), e(c3), e(c4), ?-, e(d1), e(d2), e(d3), e(d4), ?-, e(e1), e(e2), e(e3), e(e4),
      e(e5), e(e6), e(e7), e(e8), e(e9), e(e10), e(e11), e(e12)>>
  end

  @compile {:inline, e: 1}

  defp e(0), do: ?0
  defp e(1), do: ?1
  defp e(2), do: ?2
  defp e(3), do: ?3
  defp e(4), do: ?4
  defp e(5), do: ?5
  defp e(6), do: ?6
  defp e(7), do: ?7
  defp e(8), do: ?8
  defp e(9), do: ?9
  defp e(10), do: ?a
  defp e(11), do: ?b
  defp e(12), do: ?c
  defp e(13), do: ?d
  defp e(14), do: ?e
  defp e(15), do: ?f

  @doc """
  Output a 2-tuple relation (table) reference as pg-style `"schema"."table"`.

  ## Examples

      iex> inspect_relation({"schema", "table"})
      ~S|"schema"."table"|
  """
  @spec inspect_relation({String.t(), String.t()}) :: String.t()
  def inspect_relation({schema, name}) do
    "#{inspect(schema)}.#{inspect(name)}"
  end

  @doc """
  Map each value of the enumerable using a mapper, unwrapping a result tuple returned by
  the mapper and stopping on error.

  ## Examples

      iex> map_while_ok(["2015-01-23 23:50:07.0", "2015-01-23 23:50:08"], &NaiveDateTime.from_iso8601/1)
      {:ok, [~N[2015-01-23 23:50:07.0], ~N[2015-01-23 23:50:08]]}

      iex> map_while_ok(["2015-01-23 23:50:07A", "2015-01-23 23:50:08"], &NaiveDateTime.from_iso8601/1)
      {:error, :invalid_format}
  """
  @spec map_while_ok(Enumerable.t(elem), (elem -> {:ok, result} | {:error, term()})) ::
          {:ok, list(result)} | {:error, term()}
        when elem: var, result: var
  def map_while_ok(enum, mapper) when is_function(mapper, 1) do
    Enum.reduce_while(enum, {:ok, []}, fn elem, {:ok, acc} ->
      case mapper.(elem) do
        {:ok, value} -> {:cont, {:ok, [value | acc]}}
        {:error, _} = error -> {:halt, error}
      end
    end)
    |> case do
      {:ok, x} -> {:ok, Enum.reverse(x)}
      error -> error
    end
  end

  @doc """
  Return a list of values from `enum` that are the maximal elements as calculated
  by the given `fun`.

  Base behaviour is similar to `Enum.max_by/4`, but this function returns a list
  of all maximal values instead of just the first one.

  ## Examples

      iex> all_max_by([4, 1, 1, 3, -4], &abs/1)
      [4, -4]

      iex> all_max_by([4, 1, -1, 3, 4], &abs/1, &<=/2)
      [1, -1]

      iex> all_max_by([], &abs/1)
      ** (Enum.EmptyError) empty error
  """
  def all_max_by(
        enum,
        fun,
        sorter \\ &>=/2,
        comparator \\ &==/2,
        empty_fallback \\ fn -> raise(Enum.EmptyError) end
      )

  def all_max_by([], _, _, _, empty_fallback), do: empty_fallback.()

  def all_max_by([head | tail], fun, sorter, comparator, _) when is_function(fun, 1) do
    {_, max_values} =
      Enum.reduce(tail, {fun.(head), [head]}, fn elem, {curr_max, agg} ->
        new = fun.(elem)

        cond do
          comparator.(curr_max, new) -> {curr_max, [elem | agg]}
          sorter.(curr_max, new) -> {curr_max, agg}
          true -> {new, [elem]}
        end
      end)

    Enum.reverse(max_values)
  end

  @doc """
  Parse a markdown table from a string

  Options:
  - `after:` - taking a first table that comes right after a given substring.

  ## Example

      iex> \"""
      ...> Some text
      ...>
      ...> ## Known types
      ...>
      ...> | type                    | category | preferred? |
      ...> | ----------------------- | -------- | ---------- |
      ...> | bool                    | boolean  | t          |
      ...> | int2                    | numeric  |            |
      ...> \"""|> parse_md_table(after: "## Known types")
      [["bool", "boolean", "t"], ["int2", "numeric", ""]]

      iex> \"""
      ...> Some text
      ...> \"""|> parse_md_table([])
      []
  """
  @spec parse_md_table(String.t(), [{:after, String.t()}]) :: [[String.t(), ...]]
  def parse_md_table(string, opts) do
    string =
      case Keyword.fetch(opts, :after) do
        {:ok, split_on} -> List.last(String.split(string, split_on))
        :error -> string
      end

    string
    |> String.split("\n", trim: true)
    |> Enum.drop_while(&(not String.starts_with?(&1, "|")))
    |> Enum.take_while(&String.starts_with?(&1, "|"))
    # Header and separator
    |> Enum.drop(2)
    |> Enum.map(fn line ->
      line
      |> String.split("|", trim: true)
      |> Enum.map(&String.trim/1)
    end)
  end

  @doc """
  Format a relation tuple to be correctly escaped for use in SQL queries.

  ## Examples

      iex> relation_to_sql({"public", "items"})
      ~S|"public"."items"|

      iex> relation_to_sql({"with spaces", ~S|and "quoted"!|})
      ~S|"with spaces"."and ""quoted""!"|
  """
  @spec relation_to_sql(Electric.relation()) :: String.t()
  def relation_to_sql({schema, table}) do
    ~s|"#{escape_quotes(schema)}"."#{escape_quotes(table)}"|
  end

  def escape_quotes(text), do: :binary.replace(text, ~S|"|, ~S|""|, [:global])

  @doc """
  Parses quoted names.

  ## Examples
      iex> parse_quoted_name("foo")
      "foo"

      iex> parse_quoted_name(~S|"foo"|)
      "foo"

      iex> parse_quoted_name(~S|"fo""o"|)
      ~S|fo\"o|
  """
  def parse_quoted_name(str) do
    if String.first(str) == ~s(") && String.last(str) == ~s(") do
      # Remove the surrounding quotes and also unescape any escaped quotes
      str
      |> String.slice(1..-2//1)
      |> String.replace(~r/""/, ~s("))
    else
      str
    end
  end

  @doc """
  Applies either an anonymous function or a MFA tuple, prepending the given arguments
  in case of an MFA.

  ## Examples

      iex> apply_fn_or_mfa(&String.contains?(&1, "foo"), ["foobar"])
      true

      iex> apply_fn_or_mfa({String, :contains?, ["foo"]}, ["foobar"])
      true
  """
  def apply_fn_or_mfa(fun, args) when is_function(fun) and is_list(args), do: apply(fun, args)

  def apply_fn_or_mfa({mod, fun, args}, more_args)
      when is_atom(mod) and is_atom(fun) and is_list(args) and is_list(more_args),
      do: apply(mod, fun, more_args ++ args)
end
