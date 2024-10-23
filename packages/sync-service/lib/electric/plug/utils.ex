defmodule Electric.Plug.Utils do
  @moduledoc """
  Utility functions for Electric endpoints, e.g. for parsing and validating
  path and query parameters.
  """

  @doc """
  Parse columns parameter from a string consisting of a comma separated list
  of potentially quoted column names into a sorted list of strings.

  ## Examples
      iex> Electric.Plug.Utils.parse_columns_param("")
      {:error, "Invalid zero-length delimited identifier"}
      iex> Electric.Plug.Utils.parse_columns_param("foo,")
      {:error, "Invalid zero-length delimited identifier"}
      iex> Electric.Plug.Utils.parse_columns_param("id")
      {:ok, ["id"]}
      iex> Electric.Plug.Utils.parse_columns_param("id,name")
      {:ok, ["id", "name"]}
      iex> Electric.Plug.Utils.parse_columns_param(~S|"PoT@To",PoTaTo|)
      {:ok, ["PoT@To", "potato"]}
      iex> Electric.Plug.Utils.parse_columns_param(~S|"PoTaTo,sunday",foo|)
      {:ok, ["PoTaTo,sunday", "foo"]}
      iex> Electric.Plug.Utils.parse_columns_param(~S|"fo""o",bar|)
      {:ok, [~S|fo"o|, "bar"]}
      iex> Electric.Plug.Utils.parse_columns_param(~S|"id,"name"|)
      {:error, ~S|Invalid unquoted identifier contains special characters: "id|}
  """
  @spec parse_columns_param(binary()) :: {:ok, [String.t(), ...]} | {:error, term()}

  def parse_columns_param(columns) when is_binary(columns) do
    columns
    # Split by commas that are not inside quotes
    |> String.split(~r/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    |> Enum.reduce_while([], fn column, acc ->
      case Electric.Postgres.Identifiers.parse(column) do
        {:ok, casted_column} -> {:cont, [casted_column | acc]}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> then(fn result ->
      case result do
        # TODO: convert output to MapSet?
        parsed_cols when is_list(parsed_cols) -> {:ok, Enum.reverse(parsed_cols)}
        {:error, reason} -> {:error, reason}
      end
    end)
  end

  @doc """
  Calculate the next interval that should be used for long polling based on the
  current time and previous interval used.
  """
  @oct9th2024 DateTime.from_naive!(~N[2024-10-09 00:00:00], "Etc/UTC")
  @spec seconds_since_oct9th_2024_next_interval(integer(), binary() | nil) :: integer()
  def seconds_since_oct9th_2024_next_interval(long_poll_timeout_ms, prev_interval \\ nil) do
    case div(long_poll_timeout_ms, 1000) do
      0 ->
        0

      long_poll_timeout_sec ->
        now = DateTime.utc_now()

        diff_in_seconds = DateTime.diff(now, @oct9th2024, :second)
        next_interval = ceil(diff_in_seconds / long_poll_timeout_sec) * long_poll_timeout_sec

        # randomize the interval if previous one is the same
        next_interval =
          if prev_interval && "#{next_interval}" == prev_interval do
            # Generate a random integer between 0 and 99999
            random_integer = :rand.uniform(100_000)
            next_interval + random_integer
          else
            next_interval
          end

        next_interval
    end
  end

  defmodule CORSHeaderPlug do
    @behaviour Plug
    import Plug.Conn
    def init(opts), do: opts

    def call(conn, opts),
      do:
        conn
        |> put_resp_header("access-control-allow-origin", get_allowed_origin(conn, opts))
        |> put_resp_header("access-control-expose-headers", "*")
        |> put_resp_header("access-control-allow-methods", get_allowed_methods(conn, opts))

    defp get_allowed_methods(_conn, opts), do: Access.get(opts, :methods, []) |> Enum.join(", ")

    defp get_allowed_origin(conn, opts) do
      Access.get(
        opts,
        :origin,
        case Plug.Conn.get_req_header(conn, "origin") do
          [origin] -> origin
          [] -> "*"
        end
      )
    end
  end
end
