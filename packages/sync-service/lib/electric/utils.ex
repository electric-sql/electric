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
  Reduce an enumerable while accumulating an accumulator, unwrapping a result tuple returned by
  the reducer and stopping on error.
  """
  @spec reduce_while_ok(Enumerable.t(elem), acc, (elem, acc -> {:ok, acc} | {:error, term()})) ::
          {:ok, acc} | {:error, term()}
        when elem: var, acc: var
  def reduce_while_ok(enum, acc, fun) do
    Enum.reduce_while(enum, {:ok, acc}, fn elem, {:ok, acc} ->
      case fun.(elem, acc) do
        {:ok, new_acc} -> {:cont, {:ok, new_acc}}
        {:error, _} = error -> {:halt, error}
      end
    end)
  end

  @doc """
  Map a value if it's in an OK tuple, but not otherwise.

  ## Examples

      iex> map_if_ok({:ok, "a"}, &String.upcase/1)
      {:ok, "A"}

      iex> map_if_ok({:error, :invalid}, &String.upcase/1)
      {:error, :invalid}
  """
  def map_if_ok({:ok, value}, fun), do: {:ok, fun.(value)}
  def map_if_ok(other, _fun), do: other

  @doc """
  Apply a function to each element of an enumerable, recursively if the element is an enumerable itself.

  ## Examples

      iex> deep_map([1, [2, [3]], 4], &(&1 * 2))
      [2, [4, [6]], 8]
  """
  @spec deep_map(Enumerable.t(elem), (elem -> result)) :: list(result)
        when elem: var, result: var
  def deep_map(enum, fun) when is_function(fun, 1) do
    Enum.map(enum, &if(Enumerable.impl_for(&1), do: deep_map(&1, fun), else: fun.(&1)))
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
  Map each value of the enumerable using a mapper and reverse the resulting list.

  Equivalent to `Enum.reverse/1` followed by `Enum.map/2`.

  ## Examples

      iex> list_reverse_map([1, 2, 3], &(&1 + 1))
      [4, 3, 2]
  """
  @spec list_reverse_map(Enumerable.t(elem), (elem -> result), list(result)) :: list(result)
        when elem: var, result: var
  def list_reverse_map(list, mapper, acc \\ [])

  def list_reverse_map([], _, acc), do: acc

  def list_reverse_map([head | tail], mapper, acc),
    do: list_reverse_map(tail, mapper, [mapper.(head) | acc])

  @doc """
  Flat map reduce that marks the last element of the enumerable.

  This is equivalent to `Enum.flat_map_reduce/3`, but mapping function receives a boolean
  indicating if the element is the last one.

  ## Examples

      iex> flat_map_reduce_mark_last(
      ...>   [1, 2, 3],
      ...>   0,
      ...>   fn
      ...>     x, false, acc -> {[x], acc + x}
      ...>     x, true, acc -> {[x * 2], acc + x}
      ...>   end
      ...> )
      {[1, 2, 6], 6}
  """
  def flat_map_reduce_mark_last(enum, acc, fun) do
    {items_rev, {acc, pending}} =
      Enum.reduce(enum, {[], {acc, nil}}, fn elem, {items, {acc, pending}} ->
        {new_items, new_acc} = fun.(elem, false, acc)

        case pending do
          nil ->
            {items, {new_acc, {new_items, acc, elem}}}

          {prev_items, _, _} ->
            {reduce_reverse(prev_items, items), {new_acc, {new_items, acc, elem}}}
        end
      end)

    case pending do
      nil ->
        {:lists.reverse(items_rev), acc}

      {_, acc, last_elem} ->
        {final_items, final_acc} = fun.(last_elem, true, acc)
        {:lists.reverse(reduce_reverse(final_items, items_rev)), final_acc}
    end
  end

  defp reduce_reverse(list, acc) do
    Enum.reduce(list, acc, fn x, acc -> [x | acc] end)
  end

  @doc """
  Like `Enum.unzip/1`, but works for any tuple size instead of just 2.

  Returns nil on empty list.

  ## Examples

      iex> unzip_any([{1, 2}, {3, 4}])
      {[1, 3], [2, 4]}

      iex> unzip_any([{1, 2, 3}, {4, 5, 6}])
      {[1, 4], [2, 5], [3, 6]}

      iex> unzip_any([{1, 2, 3, 4, 5, 6}, {7, 8, 9, 10, 11, 12}])
      {[1, 7], [2, 8], [3, 9], [4, 10], [5, 11], [6, 12]}
  """
  def unzip_any([]), do: nil

  def unzip_any([head | _] = list) when is_tuple(head) do
    base_acc = for(_ <- 1..tuple_size(head)//1, do: [])
    unzip_any(Enum.reverse(list), base_acc)
  end

  defp unzip_any([], acc), do: List.to_tuple(acc)

  # This is used in move handling, where composite mathces over 3 columns are exceedingly rare
  # but we want to support them anyway.
  # To make this faster, I've unrolled the 3 common cases to avoid the Enum.with_index/1 call
  # unless necessary.
  defp unzip_any([{e1, e2} | tail], [l1, l2]),
    do: unzip_any(tail, [[e1 | l1], [e2 | l2]])

  defp unzip_any([{e1, e2, e3} | tail], [l1, l2, l3]),
    do: unzip_any(tail, [[e1 | l1], [e2 | l2], [e3 | l3]])

  defp unzip_any([{e1, e2, e3, e4} | tail], [l1, l2, l3, l4]),
    do: unzip_any(tail, [[e1 | l1], [e2 | l2], [e3 | l3], [e4 | l4]])

  defp unzip_any([head | tail], acc) do
    acc = Enum.with_index(acc, fn list_n, n -> [elem(head, n) | list_n] end)
    unzip_any(tail, acc)
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
      ~S|public.items|

      iex> relation_to_sql({"public", "items"}, true)
      ~S|"public"."items"|

      iex> relation_to_sql({"public", "items-again"})
      ~S|public."items-again"|

      iex> relation_to_sql({"public", "99red_balloons"})
      ~S|public."99red_balloons"|

      iex> relation_to_sql({"public", "when"})
      ~S|public."when"|

      iex> relation_to_sql({"with spaces", ~S|and "quoted"!|})
      ~S|"with spaces"."and ""quoted""!"|
  """
  @spec relation_to_sql(Electric.relation()) :: String.t()
  def relation_to_sql(relation, force_quote \\ false)

  def relation_to_sql({schema, table}, true) do
    ~s|#{quote_name(schema)}.#{quote_name(table)}|
  end

  def relation_to_sql({schema, table}, false) do
    ~s|#{maybe_quote(schema)}.#{maybe_quote(table)}|
  end

  defp maybe_quote(name) do
    if needs_quoting?(name) do
      quote_name(name)
    else
      name
    end
  end

  # from https://www.postgresql.org/docs/current/sql-keywords-appendix.html
  @reserved MapSet.new(~w(
    all analyse analyze and any array as asc asymmetric authorization
    binary both
    case cast check collate collation column concurrently constraint
      create cross current_catalog current_date current_role current_schema
      current_time current_timestamp current_user
    default deferrable desc distinct do
    else end except
    false fetch for foreign freeze from full
    grant group
    having
    ilike in initially inner intersect into is isnull
    join
    lateral leading left like limit localtime localtimestamp
    natural not notnull null
    offset on only or order outer overlaps
    placing primary
    references returning right
    select session_user similar some symmetric system_user
    table tablesample then to trailing true
    union unique user using
    variadic verbose
    when where window with
  ))

  @safe_first_chars Enum.concat(?a..?z, [?_])
  @safe_chars Enum.concat(@safe_first_chars, ?0..?9)

  defp needs_quoting?(name) do
    String.downcase(name) in @reserved || unsafe_name?(name)
  end

  defp unsafe_name?(<<c::8, _::binary>>) when c not in @safe_first_chars, do: true
  defp unsafe_name?(<<_::8, rest::binary>>), do: unsafe_char?(rest)

  defp unsafe_char?(<<c::8, _rest::binary>>) when c not in @safe_chars, do: true
  defp unsafe_char?(<<_::binary-1, rest::binary>>), do: unsafe_char?(rest)
  defp unsafe_char?(<<>>), do: false

  def escape_quotes(text, quot_char \\ ?"),
    do: :binary.replace(text, <<quot_char>>, <<quot_char, quot_char>>, [:global])

  @doc """
  Quote the given identifier for use in SQL queries.

  ## Examples
      iex> quote_name("foo")
      ~S|"foo"|

      iex> quote_name(~S|fo"o|)
      ~S|"fo""o"|
  """
  @spec quote_name(String.t()) :: String.t()
  def quote_name(str), do: ~s|"#{escape_quotes(str)}"|

  @doc """
  Quote the given binary for use as a literal string in SQL queries.
  """
  @spec quote_string(String.t()) :: String.t()
  def quote_string(str), do: ~s|'#{escape_quotes(str, ?')}'|

  @doc """
  Parses quoted names.
  Lowercases unquoted names to match Postgres' case insensitivity.

  ## Examples
      iex> parse_quoted_name("foo")
      "foo"

      iex> parse_quoted_name(~S|"foo"|)
      "foo"

      iex> parse_quoted_name(~S|"fo""o"|)
      ~S|fo"o|

      iex> parse_quoted_name(~S|"FooBar"|)
      ~S|FooBar|

      iex> parse_quoted_name(~S|FooBar|)
      ~S|FooBar|
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

  @doc """
  Given a keyword list of database connection options, obfuscate the password by wrapping it in
  a zero-arity function.

  This should be done as early as possible when parsing connection options from the OS env. The
  aim of this obfuscation is to avoid accidentally leaking the password when inspecting connection
  opts or logging them as part of a process state (which is done automatically by OTP when a
  process that implements an OTP behaviour crashes).
  """
  @spec obfuscate_password(Keyword.t()) :: Keyword.t()
  def obfuscate_password(connection_opts) when is_list(connection_opts) do
    Keyword.update!(connection_opts, :password, &wrap_in_fun/1)
  end

  def obfuscate_password(connection_opts) when is_map(connection_opts) do
    Map.update!(connection_opts, :password, &wrap_in_fun/1)
  end

  @doc """
  Undo the obfuscation applied by `obfuscate_password/1`.

  This function should be called just before passing connection options to one of
  `Postgrex` functions. Never store deobfuscated password in any of our process
  states.
  """
  @spec deobfuscate_password(Keyword.t()) :: Keyword.t()
  def deobfuscate_password(connection_opts) do
    Keyword.update!(connection_opts, :password, fn passw -> passw.() end)
  end

  @doc """
  Apply a function to each value of a map.
  """
  @spec map_values(map(), (term() -> term())) :: map()
  def map_values(map, fun), do: Map.new(map, fn {k, v} -> {k, fun.(v)} end)

  @doc false
  def wrap_in_fun(val) when is_function(val, 0), do: val
  def wrap_in_fun(val), do: fn -> val end

  @type sortable_binary(key) :: {key :: key, data :: binary()}
  @type item_reader_fn(elem) :: (file :: :file.io_device() -> sortable_binary(elem) | :halt)

  @spec stream_file_items(
          path :: String.t(),
          reader :: item_reader_fn(elem)
        ) :: Enumerable.t(sortable_binary(elem))
        when elem: var
  def stream_file_items(path, item_reader) when is_function(item_reader, 1) do
    Stream.resource(
      fn ->
        File.open!(path, [:read, :raw])
      end,
      fn file ->
        case item_reader.(file) do
          :halt -> {:halt, file}
          value -> {[value], file}
        end
      end,
      &File.close/1
    )
  end

  @doc """
  Transform the stream to call a side-effect function for each element before continuing.

  Acts like `Stream.each/2` but with an aggregate. `start_fun`, `last_fun`, `after_fun`
  have the same semantics as in `Stream.transform/5`
  """
  def stream_add_side_effect(stream, start_fun, reducer, last_fun \\ & &1, after_fun \\ & &1) do
    Stream.transform(
      stream,
      start_fun,
      fn elem, acc ->
        {[elem], reducer.(elem, acc)}
      end,
      fn acc -> {[], last_fun.(acc)} end,
      after_fun
    )
  end

  @spec merge_all([keyword()]) :: keyword()
  def merge_all([keyword | keywords]) do
    Enum.reduce(keywords, keyword, fn k, merged ->
      Keyword.merge(merged, k)
    end)
  end

  @doc """
  Extract keys from a map that start with a given prefix into a nested map.

  ## Examples

      iex> extract_prefixed_keys_into_map(%{"foo_bar" => "baz", "foo_moo" => "qux", "other" => "value"}, "foo")
      %{"foo" => %{"bar" => "baz", "moo" => "qux"}, "other" => "value"}

      iex> extract_prefixed_keys_into_map(%{"other" => "value"}, "foo")
      %{"other" => "value"}
  """
  @spec extract_prefixed_keys_into_map(map(), String.t(), String.t()) :: map()
  def extract_prefixed_keys_into_map(map, prefix, joiner \\ "_") do
    {prefixed, rest} =
      Enum.split_with(map, fn {k, _} -> String.starts_with?(k, prefix <> joiner) end)

    if prefixed == [] do
      map
    else
      nested =
        Map.new(prefixed, fn {k, v} -> {String.replace_prefix(k, prefix <> joiner, ""), v} end)

      Map.new([{prefix, nested} | rest])
    end
  end
end
