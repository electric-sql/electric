defmodule Support.ULID do
  # A dumb parameterized type that stores a UUID with a prefix in the application
  # useful for testing the handling of uuid-format columns in e.g. the query
  # generator
  use Ecto.ParameterizedType

  @impl Ecto.ParameterizedType
  def init(opts) do
    Map.new(opts)
  end

  @impl Ecto.ParameterizedType
  def type(_), do: :uuid

  @impl Ecto.ParameterizedType
  def cast(value, %{prefix: prefix}) do
    if String.starts_with?(value, prefix <> "_") do
      {:ok, value}
    else
      :error
    end
  end

  @impl Ecto.ParameterizedType
  def load(nil, _, _), do: {:ok, nil}

  def load(data, _loader, %{prefix: prefix}) when is_binary(data) do
    with {:ok, uuid} = Ecto.UUID.load(data) do
      {:ok, prefix <> "_" <> uuid}
    end
  end

  def load(_, _, _), do: :error

  @impl Ecto.ParameterizedType
  def dump(nil, _, _), do: {:ok, nil}

  def dump(ulid, _, %{prefix: prefix}) do
    with [^prefix, uuid] <- String.split(ulid, "_", parts: 2) do
      Ecto.UUID.dump(uuid)
    else
      _ -> :error
    end
  end

  def dump(_, _, _), do: :error

  @impl Ecto.ParameterizedType
  def equal?(nil, nil, _), do: true
  def equal?(val, val, _), do: true
  def equal?(_, _, _), do: false
end
