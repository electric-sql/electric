defmodule PgInterop.Array do
  defguardp is_space(c) when c in [?\s, ?\t, ?\n, ?\r, ?\v, ?\f]

  @doc ~S"""
  Parse a Postgres string-serialized array into a list of strings, unwrapping the escapes. Parses nested arrays.
  If a casting function is provided, it will be applied to each element.

  Parsing follows SOME of the same rules as the postgres parser, in particular:
  1. at most 6 nesting levels are allowed,
  2. arrays must be of uniform dimension, i.e. all sub-arrays must have the same number of elements if at the same depth.

  This implementation also breaks away from the postgres parser in that some bugs are NOT reimplemented:
  - `select '{{1},{{2}}}'::text[];` yields `{{{1}},{{2}}}` in PG, we raise an error
  - `select '{{{1}},{2}}'::text[];` yields `{}` in PG, we raise an error
  - `select '{{{1}},{2},{{3}}}::text[];` yields `{{{1}},{{NULL}},{{3}}}` in PG, we raise an error

  ## Examples

      iex> ~S|{"(\"2023-06-15 11:18:05.372698+00\",)"}| |> parse()
      [~s|("2023-06-15 11:18:05.372698+00",)|]

      iex> ~S|{"(\"2023-06-15 11:18:05.372698+00\",)","(\"2023-06-15 11:18:05.372698+00\",)"}| |> parse()
      [~s|("2023-06-15 11:18:05.372698+00",)|, ~s|("2023-06-15 11:18:05.372698+00",)|]

      iex> ~S|{hello, world, null, "null"}| |> parse()
      ["hello", "world", nil, "null"]

      iex> ~S|{"2023-06-15 11:18:05.372698+00",2023-06-15 11:18:05.372698+00}| |> parse(fn x -> {:ok, n, _} = DateTime.from_iso8601(x); n end)
      [~U[2023-06-15 11:18:05.372698Z], ~U[2023-06-15 11:18:05.372698Z]]

      iex> ~s|{ "1" , 3  ,   "2" ,    3 3  }| |> parse()
      ["1", "3", "2", "3 3"]

      iex> ~s|{ {{1, 1}, { "2"   , 2 }} ,{{"3", 3}, {4, 4} }, {  {5, 5},{6, 6}  }}| |> parse(&String.to_integer/1)
      [[[1, 1], [2, 2]], [[3, 3], [4, 4]], [[5, 5], [6, 6]]]

      iex> ~s|{ "1" ,   "2" ,    3 3   , , 4}| |> parse()
      ** (RuntimeError) Unexpected ',' character

      iex> ~s|{ "1" , 3,  "2" ,    3 3   , }| |> parse()
      ** (RuntimeError) Unexpected '}' character

      iex> ~s|{ {1} ,{   2 }, {3  }}  }| |> parse()
      ** (RuntimeError) Invalid array syntax

      iex> ~s|{{{1} ,{   2 }, {3  }} | |> parse()
      ** (RuntimeError) Unexpected end of input

      iex> ~s|{"}| |> parse()
      ** (RuntimeError) Unexpected end of input

      iex> ~s|{{1},2,{3}}| |> parse(&String.to_integer/1)
      ** (RuntimeError) Unexpected array element

      iex> ~s|{{{{{{{1}}}}}}}| |> parse()
      ** (RuntimeError) number of dimensions (7) exceeds maximum of 6

      iex> ~s|{ {1} ,{   {2} }, {3  }}| |> parse()
      ** (RuntimeError) Inconsistent array dimensions

      iex> ~s|{ {{1}} ,{2}, {3  }}| |> parse()
      ** (RuntimeError) Inconsistent array dimensions
  """
  def parse(str, casting_fun \\ & &1)

  def parse("{}", _), do: []

  def parse(str, casting_fun) do
    case parse_nested_arrays(str, casting_fun, %{cur_dim: 1}) do
      {result, "", _} ->
        result

      {result, rest, _} ->
        if String.match?(rest, ~r/^\s$/) do
          result
        else
          raise "Invalid array syntax"
        end
    end
  end

  defp parse_nested_arrays(<<c>> <> rest, fun, dim_info) when is_space(c),
    do: parse_nested_arrays(rest, fun, dim_info)

  defp parse_nested_arrays(_, _, %{cur_dim: dim}) when dim > 6,
    do: raise("number of dimensions (#{dim}) exceeds maximum of 6")

  defp parse_nested_arrays(_, _, %{cur_dim: dim, max_dim: max_dim}) when dim > max_dim,
    do: raise("Inconsistent array dimensions")

  defp parse_nested_arrays("{" <> rest, fun, %{cur_dim: dim} = dim_info) do
    # we're in an array, need to parse all the elements at this level
    case String.trim_leading(rest) do
      "" ->
        raise "Unexpected end of input"

      "{" <> _ = rest ->
        parse_all_nested_arrays(rest, fun, [], 0, dim_info)

      _ ->
        # If we know max dimension but see a non-array element, before that, we know it's inconsistent
        if is_map_key(dim_info, :max_dim) and dim_info.max_dim > dim do
          raise "Inconsistent array dimensions"
        end

        {result, rest, dim_size} = parse_all_elements(rest, fun)

        # If we've been at this depth, validate that new array is consistent with the previous ones,
        # if not, save it
        case Map.fetch(dim_info, dim) do
          {:ok, ^dim_size} ->
            {result, rest, dim_info}

          :error ->
            {result, rest, Map.put(dim_info, dim, dim_size)}

          {:ok, _} ->
            raise "Inconsistent array dimensions"
        end
    end
  end

  defp parse_nested_arrays(_, _, _), do: raise("Unexpected array element")

  defp parse_all_nested_arrays(str, fun, acc, dim_size, %{cur_dim: dim} = dim_info) do
    {result, rest, dim_info} = parse_nested_arrays(str, fun, %{dim_info | cur_dim: dim + 1})
    dim_info = %{dim_info | cur_dim: dim}

    # First time we reach this branch is when we followed all open braces at the start
    # of the string, so we know the maximum dimension of the array
    dim_info = Map.put_new(dim_info, :max_dim, dim + 1)

    case scan_until_next_boundary(rest) do
      # If next boundary is a comma, we're at the same depth, so keep parsing
      {?,, rest} ->
        parse_all_nested_arrays(rest, fun, [result | acc], dim_size + 1, dim_info)

      # If next boundary is a closing brace, we're done with this array, so update what we can
      {?}, rest} ->
        dim_size = dim_size + 1

        # If we've been at this depth, validate that new array is consistent with the previous ones,
        # if not, save it
        case Map.fetch(dim_info, dim) do
          {:ok, ^dim_size} ->
            {Enum.reverse([result | acc]), rest, dim_info}

          :error ->
            {Enum.reverse([result | acc]), rest, Map.put(dim_info, dim, dim_size)}

          {:ok, _} ->
            raise "Inconsistent array dimensions"
        end
    end
  end

  defp parse_all_elements(str, fun, acc \\ [], dim \\ 0)
  defp parse_all_elements("", _, _, _), do: raise("Unexpected end of input")

  defp parse_all_elements(<<c>> <> rest, fun, acc, dim) when is_space(c),
    do: parse_all_elements(rest, fun, acc, dim)

  defp parse_all_elements(str, fun, acc, dim) do
    {type, {elem, rest}} = scan_next_element(str)

    case scan_until_next_boundary(rest) do
      {?,, rest} -> parse_all_elements(rest, fun, [apply_fun(type, elem, fun) | acc], dim + 1)
      {?}, rest} -> {Enum.reverse([apply_fun(type, elem, fun) | acc]), rest, dim + 1}
    end
  end

  defp scan_next_element(<<?{>> <> _), do: raise("Unexpected '{' character")
  defp scan_next_element(<<?">> <> rest), do: {:quoted, scan_until_quote(rest, "")}
  defp scan_next_element(rest), do: {:unquoted, scan_until_comma_or_end(rest, "", "")}

  defp scan_until_quote("", _), do: raise("Unexpected end of input")
  defp scan_until_quote(<<?">> <> rest, acc), do: {acc, rest}
  defp scan_until_quote(~S'\"' <> str, acc), do: scan_until_quote(str, acc <> ~S'"')
  defp scan_until_quote(~S'\\' <> str, acc), do: scan_until_quote(str, acc <> ~S'\\')
  defp scan_until_quote(<<c>> <> str, acc), do: scan_until_quote(str, acc <> <<c>>)

  defp scan_until_comma_or_end("", _, _), do: raise("Unexpected end of input")

  defp scan_until_comma_or_end(<<c>> <> _, "", _) when c in [?,, ?}],
    do: raise("Unexpected '#{[c]}' character")

  defp scan_until_comma_or_end("}" <> _ = rest, acc, _acc_whitespace), do: {acc, rest}
  defp scan_until_comma_or_end(<<?,>> <> _ = str, acc, _acc_whitespace), do: {acc, str}

  defp scan_until_comma_or_end(<<c>> <> str, "", "") when is_space(c),
    do: scan_until_comma_or_end(str, "", "")

  defp scan_until_comma_or_end(<<c>> <> str, acc, acc_whitespace) when is_space(c),
    do: scan_until_comma_or_end(str, acc, acc_whitespace <> <<c>>)

  defp scan_until_comma_or_end(<<c>> <> str, acc, acc_whitespace),
    do: scan_until_comma_or_end(str, acc <> acc_whitespace <> <<c>>, "")

  defp scan_until_next_boundary(""), do: raise("Unexpected end of input")
  defp scan_until_next_boundary(<<c>> <> rest) when c in [?,, ?}], do: {c, rest}

  defp scan_until_next_boundary(<<c>> <> rest) when is_space(c),
    do: scan_until_next_boundary(rest)

  defp scan_until_next_boundary(<<c>> <> _), do: raise("Unexpected '#{[c]}' character")

  defp apply_fun(:quoted, elem, fun), do: fun.(elem)

  defp apply_fun(:unquoted, elem, fun) do
    if String.downcase(elem) == "null", do: nil, else: fun.(elem)
  end

  @doc ~S"""
  Serialize a list of strings into a postgres string-serialized array into a list of strings, wrapping the contents

  ## Examples

      iex> [~s|("2023-06-15 11:18:05.372698+00",)|] |> serialize()
      ~S|{"(\"2023-06-15 11:18:05.372698+00\",)"}|

      iex> [~s|("2023-06-15 11:18:05.372698+00",)|, ~s|("2023-06-15 11:18:05.372698+00",)|] |> serialize()
      ~S|{"(\"2023-06-15 11:18:05.372698+00\",)","(\"2023-06-15 11:18:05.372698+00\",)"}|

      iex> str = ~S|{"(\"2023-06-15 11:18:05.372698+00\",)","(\"2023-06-15 11:18:05.372698+00\",)"}|
      iex> str |> parse() |> serialize()
      str
  """
  def serialize(array, quote_char \\ ?") when is_list(array) do
    array
    |> Enum.map_join(",", fn
      nil -> "null"
      val when is_binary(val) -> val |> String.replace(~S|"|, ~S|\"|) |> enclose(<<quote_char>>)
    end)
    |> enclose("{", "}")
  end

  defp enclose(str, left, right \\ nil) do
    left <> str <> (right || left)
  end

  @doc """
  Access a slice or index of a postgres array.

  ## Examples

      iex> ~S|{1,2,3,4,5}| |> parse(&String.to_integer/1) |> slice_access([{:slice, nil, 3}])
      [1, 2, 3]

      iex> ~S|{1,2,3,4,5}| |> parse(&String.to_integer/1) |> slice_access([{:slice, 3, nil}])
      [3, 4, 5]

      iex> ~S|{1,2,3,4,5}| |> parse(&String.to_integer/1) |> slice_access([{:slice, 3, 4}])
      [3, 4]

      iex> ~S|{{1,2},{3,4}}| |> parse(&String.to_integer/1) |> slice_access([{:slice, nil, nil}, {:index, 2}])
      [[1, 2], [3, 4]]

      iex> ~S|{{1,2},{3,4}}| |> parse(&String.to_integer/1) |> slice_access([{:slice, nil, nil}, {:slice, 2, 2}])
      [[2], [4]]

      iex> ~S|{{1,2},{3,4}}| |> parse(&String.to_integer/1) |> slice_access([{:slice, nil, nil}, {:slice, -1, 1}])
      [[1], [3]]

      iex> ~S|{{1,2},{3,4}}| |> parse(&String.to_integer/1) |> slice_access([{:slice, nil, nil}, {:slice, 1, -1}])
      []
  """
  @spec slice_access(
          list(),
          list({:slice, nil | integer(), nil | integer()} | {:index, integer()})
        ) :: list()
  def slice_access(array, instructions) do
    do_slice_access(array, instructions)
  catch
    :out_of_bounds -> []
  end

  defp do_slice_access(elem, [_ | _]) when not is_list(elem), do: throw(:out_of_bounds)
  defp do_slice_access(array, []), do: array

  defp do_slice_access(array, [{:slice, nil, nil} | rest]),
    do: Enum.map(array, &do_slice_access(&1, rest))

  defp do_slice_access(_array, [{:slice, lower_idx, upper_idx} | _])
       when is_integer(lower_idx) and is_integer(upper_idx) and
              (lower_idx > upper_idx or upper_idx < 1),
       do: throw(:out_of_bounds)

  defp do_slice_access(array, [{:slice, lower_idx, upper_idx} | rest]),
    do:
      array
      |> Enum.slice((normalize_idx(lower_idx) || 0)..(normalize_idx(upper_idx) || -1)//1)
      |> Enum.map(&do_slice_access(&1, rest))

  defp do_slice_access(array, [{:index, idx} | rest]),
    do: do_slice_access(array, [{:slice, 1, idx} | rest])

  @doc """
  Access an index of a postgres array. If the index is out of bounds or array has more dimensions than the indices provided, returns `nil`.

  ## Examples

      iex> ~S|{1,2,3,4,5}| |> parse(&String.to_integer/1) |> index_access([{:index, 3}])
      3

      iex> ~S|{{1,2},{3,4}}| |> parse(&String.to_integer/1) |> index_access([{:index, 2}, {:index, 1}])
      3

      iex> ~S|{{1,2},{3,4}}| |> parse(&String.to_integer/1) |> index_access([{:index, 3}])
      nil
  """
  @spec index_access(list(), list({:index, integer()})) :: list()
  def index_access(array, list_of_indices) do
    Enum.reduce_while(list_of_indices, array, fn
      _, nil -> {:halt, nil}
      {:index, idx}, _acc when idx < 1 -> {:halt, nil}
      {:index, idx}, acc -> {:cont, Enum.at(acc, idx - 1)}
    end)
    |> case do
      [] -> nil
      result -> result
    end
  end

  defp normalize_idx(nil), do: nil
  defp normalize_idx(pg_index) when pg_index < 1, do: 0
  defp normalize_idx(pg_index), do: pg_index - 1

  def concat_arrays(arr1, []), do: arr1
  def concat_arrays([], arr2), do: arr2

  def concat_arrays(arr1, arr2) do
    case {get_array_dim(arr1), get_array_dim(arr2)} do
      {d1, d1} -> arr1 ++ arr2
      {d1, d2} when d2 - d1 == 1 -> [arr1 | arr2]
      {d1, d2} when d1 - d2 == 1 -> arr1 ++ [arr2]
      {d1, d2} -> raise "Incompatible array dimensions: #{d1} and #{d2}"
    end
  end

  @doc """
  Get the dimension of a postgres array.

  ## Examples

      iex> ~S|{}| |> parse() |> get_array_dim()
      nil

      iex> ~S|{1,2,3,4,5}| |> parse() |> get_array_dim()
      1

      iex> ~S|{{1,2},{3,4}}| |> parse() |> get_array_dim()
      2
  """
  @spec get_array_dim(list()) :: non_neg_integer()
  def get_array_dim(arr, dim \\ 0)
  def get_array_dim([], _), do: nil
  def get_array_dim([hd | _], dim), do: get_array_dim(hd, dim + 1)
  def get_array_dim(_, dim), do: dim

  def array_prepend(elem, []), do: [elem]
  def array_prepend(elem, [hd | tl]) when not is_list(hd), do: [elem, hd | tl]

  def array_append([], elem), do: [elem]
  def array_append([hd | _] = list, elem) when not is_list(hd), do: list ++ [elem]
end
