defmodule Electric.DDLX.Parser.Macros do
  @doc """
  Produces a function head that matches a string in a case insensitive way.

  E.g.

       deftoken :in?, "IN" do
         true
       end


       def in?(<<c0::8, c1::8>> = stmt) when c0 in [?i, ?I] and c1 in [?n, ?N] do
         true
       end

  this only matches exact strings with no leading or trailing characters.

       iex(1)> in?("In") 
       true
       iex(2)> in?("IN") 
       true
       iex(2)> in?("in") 
       true
       # assuming we have a fallback `in?/1` function definition that returns `false`
       # for any other input, i.e.
       #
       # deftoken :in?, "IN", do: true
       # def in?(_), do: false
       iex(2)> in?("inside") 
       false

  """
  defmacro deftoken(function, keyword, do: block) do
    chars =
      keyword
      |> to_string()
      |> String.codepoints()
      |> Enum.map(fn char -> [String.downcase(char), String.upcase(char)] end)
      |> Enum.map(fn [<<l::8>>, <<u::8>>] -> [l, u] end)
      |> Enum.with_index()

    pattern = build_match(chars)
    guard = build_guard(chars)

    quote do
      def unquote(function)(unquote(pattern) = var!(stmt)) when unquote(guard) do
        _ = var!(stmt)
        unquote(block)
      end
    end
  end

  defp match_var(i), do: Macro.var(:"c#{i}", Elixir)

  # <<c0::8, c1::8, ...>>
  defp build_match(chars) do
    {:<<>>, [], Enum.map(chars, fn {_c, i} -> quote(do: unquote(match_var(i)) :: 8) end)}
  end

  defp is_member(chars, i) do
    quote do
      unquote(match_var(i)) in unquote(chars)
    end
  end

  defp build_guard([{chars, i}]) do
    is_member(chars, i)
  end

  defp build_guard([{chars, i} | rest]) do
    quote do
      unquote(is_member(chars, i)) and unquote(build_guard(rest))
    end
  end
end
