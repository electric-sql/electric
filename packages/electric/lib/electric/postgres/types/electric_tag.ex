defmodule Electric.Postgres.Types.ElectricTag do
  @doc """
  Parse a postgres string-serialized electric.tag value into an origin & a timestamp.

  If the origin in the tuple is empty, returns `default_origin` instead (`nil` by default)

  ## Examples

      iex> ~s|("2023-06-15 11:18:05.372698+00",)| |> parse()
      {~U[2023-06-15 11:18:05.372698Z], nil}

      iex> ~s|("2023-06-15 11:18:05.372698+00",test)| |> parse()
      {~U[2023-06-15 11:18:05.372698Z], "test"}

      iex> ~s|("2023-06-15 11:18:05.372698+00",)| |> parse("default")
      {~U[2023-06-15 11:18:05.372698Z], "default"}
  """
  def parse(tag, default_origin \\ nil) when is_binary(tag) do
    [ts, origin] =
      tag
      |> String.slice(1..-2//1)
      |> String.split(",", parts: 2)
      |> Enum.map(&String.trim(&1, ~s|"|))
      |> Enum.map(&String.replace(&1, ~S|\"|, ~S|"|))

    {:ok, ts, _} = DateTime.from_iso8601(ts)

    {ts, if(origin == "", do: default_origin, else: origin)}
  end

  @doc """
  Serialize an origin-timestamp pair into a postgres string-serialized electric.tag value

  If the origin matches `nil_origin` (second argument), then `null` PG value will be used in place

  ## Examples

      iex> {~U[2023-06-15 11:18:05.372698Z], nil} |> serialize()
      ~s|("2023-06-15T11:18:05.372698Z",)|

      iex> {~U[2023-06-15 11:18:05.372698Z], "test"} |> serialize()
      ~s|("2023-06-15T11:18:05.372698Z","test")|

      iex> {~U[2023-06-15 11:18:05.372698Z], "default"} |> serialize("default")
      ~s|("2023-06-15T11:18:05.372698Z",)|
  """
  def serialize({timestamp, origin}, nil_origin \\ nil) do
    origin =
      if origin == nil_origin, do: nil, else: ~s|"#{String.replace(origin, ~S|"|, ~S|\"|)}"|

    ~s|("#{DateTime.to_iso8601(timestamp)}",#{origin})|
  end
end
