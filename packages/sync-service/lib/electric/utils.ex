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
  Quote a string for use in SQL queries.

  ## Examples
      iex> quote_name("foo")
      ~S|"foo"|

      iex> quote_name(~S|fo"o|)
      ~S|"fo""o"|
  """
  @spec quote_name(String.t()) :: String.t()
  def quote_name(str), do: ~s|"#{escape_quotes(str)}"|

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
  def obfuscate_password(connection_opts) do
    Keyword.update!(connection_opts, :password, &wrap_in_fun/1)
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

  defp wrap_in_fun(val), do: fn -> val end

  @doc """
  Merge a list of streams by taking the minimum element from each stream and emitting it and its
  stream. The streams are compared using the given comparator function.

  ## Examples

      iex> merge_sorted_streams([[1, 2, 3], [2, 3, 4]]) |> Enum.to_list()
      [1, 2, 2, 3, 3, 4]

      iex> merge_sorted_streams([[1, 2, 3], [4, 5, 6]]) |> Enum.to_list()
      [1, 2, 3, 4, 5, 6]

      iex> merge_sorted_streams([[10], [4, 5, 6]]) |> Enum.to_list()
      [4, 5, 6, 10]
  """
  def merge_sorted_streams(streams, comparator \\ &<=/2, mapper \\ & &1) do
    Stream.resource(
      fn ->
        Enum.flat_map(streams, fn stream ->
          case Enum.take(stream, 1) do
            [value] -> [{value, Stream.drop(stream, 1)}]
            [] -> []
          end
        end)
      end,
      fn
        [] ->
          {:halt, nil}

        values_and_streams ->
          {val, stream} = Enum.min_by(values_and_streams, fn {value, _} -> value end, comparator)

          acc =
            case Enum.take(stream, 1) do
              [next_val] ->
                List.keyreplace(values_and_streams, val, 0, {next_val, Stream.drop(stream, 1)})

              [] ->
                List.keydelete(values_and_streams, val, 0)
            end

          {[mapper.(val)], acc}
      end,
      fn _ -> nil end
    )
  end

  @doc """
  Open a file, retrying if it doesn't exist yet, up to `attempts_left` times, with 20ms delay between
  attempts.
  """
  @spec open_with_retry(path :: String.t(), opts :: [File.mode()]) :: :file.io_device()
  def open_with_retry(path, opts, attempts_left \\ 100) when is_list(opts) do
    case File.open(path, opts) do
      {:ok, file} ->
        file

      {:error, :enoent} ->
        Process.sleep(20)
        open_with_retry(path, opts, attempts_left - 1)

      {:error, reason} ->
        raise IO.StreamError, reason: reason
    end
  end

  @type sortable_binary(key) :: {key :: key, data :: binary()}

  @doc """
  Performs external merge sort on a file.

  ## Parameters
    * `path` - Path to the file to sort
    * `reader` - Function that takes a file path and returns a stream of records. Records should be
      in the form of `{key, binary}`, where `binary` will be written to the file sorted by `key`.
    * `sorter` - Function that compares two keys, should return true if first argument is less than or equal to second
    * `chunk_size` - Byte size of each chunk (i.e. how much is sorted in memory at once). Uses 50 MB by default.

  The function will:
  1. Split the input file into sorted temporary chunks
  2. Merge the sorted chunks back into the original file
  """
  @spec external_merge_sort(
          path :: String.t(),
          reader :: (path :: String.t() -> Enumerable.t(sortable_binary(elem))),
          sorter :: (elem, elem -> boolean())
        ) :: :ok
        when elem: var
  def external_merge_sort(path, reader, sorter \\ &<=/2, chunk_size \\ 50 * 1024 * 1024) do
    tmp_dir = Path.join(System.tmp_dir!(), "external_sort_#{:erlang.system_time()}")
    File.mkdir_p!(tmp_dir)

    try do
      chunks = split_into_sorted_chunks(path, reader, sorter, tmp_dir, chunk_size)
      merge_sorted_files(chunks, path, reader, sorter)
      :ok
    after
      File.rm_rf!(tmp_dir)
    end
  end

  defp split_into_sorted_chunks(path, reader, sorter, tmp_dir, chunk_size) do
    path
    |> reader.()
    |> chunk_by_size(chunk_size)
    |> Stream.with_index()
    |> Stream.map(fn {chunk, idx} ->
      chunk_path = Path.join(tmp_dir, "chunk_#{idx}")

      chunk
      |> Enum.sort(sorter)
      |> Stream.map(fn {_, value} -> value end)
      |> Stream.into(File.stream!(chunk_path))
      |> Stream.run()

      chunk_path
    end)
    |> Enum.to_list()
  end

  @doc """
  Merge a list of sorted files into a single file.

  Uses a reader function that takes a path to a file and returns a stream of tuples `{key, binary}`,
  where `binary` will be written to the file as sorted by `key`.
  """
  def merge_sorted_files(paths, target_path, reader, sorter \\ &<=/2)

  def merge_sorted_files([path], target_path, _reader, _sorter) do
    File.stream!(path)
    |> Stream.into(File.stream!(target_path))
    |> Stream.run()
  end

  def merge_sorted_files(paths, target_path, reader, sorter) do
    paths
    |> Enum.map(reader)
    |> merge_sorted_streams(sorter, fn {_, binary} -> binary end)
    |> Stream.into(File.stream!(target_path))
    |> Stream.run()
  end

  defp chunk_by_size(stream, size) do
    Stream.chunk_while(
      stream,
      {0, []},
      fn {_, value} = full_value, {acc_size, acc} ->
        value_size = byte_size(value)

        if acc_size + value_size > size do
          {:cont, Enum.reverse(acc), {0, [full_value]}}
        else
          {:cont, {acc_size + value_size, [full_value | acc]}}
        end
      end,
      fn
        {_, []} -> {:cont, []}
        {_, acc} -> {:cont, Enum.reverse(acc), []}
      end
    )
  end

  def concat_files(paths, into) do
    # `:file.copy` is not optimized to use a syscall, so basic stream forming is good enough
    paths
    |> Enum.map(&File.stream!/1)
    |> Stream.concat()
    |> Stream.into(File.stream!(into))
    |> Stream.run()
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
end
