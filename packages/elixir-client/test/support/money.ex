defmodule Support.Money do
  use Ecto.ParameterizedType

  @impl Ecto.ParameterizedType
  def init(opts) do
    opts
  end

  @impl Ecto.ParameterizedType
  def type(_), do: :integer

  @impl Ecto.ParameterizedType
  def cast(value, _) do
    {:ok, value}
  end

  @impl Ecto.ParameterizedType
  def load(db_integer, _, _) when is_integer(db_integer) do
    dollars = Decimal.div(Decimal.new(db_integer), Decimal.new(1_000_000))
    {:ok, dollars}
  end

  def load(nil, _, _), do: {:ok, nil}
  def load(_, _, _), do: :error

  @impl Ecto.ParameterizedType
  def dump(%Decimal{} = decimal_val, _, _) do
    micro =
      decimal_val
      |> Decimal.mult(1_000_000)
      |> Decimal.to_integer()

    {:ok, micro}
  end

  def dump(nil, _, _), do: {:ok, nil}
  def dump(_, _, _), do: :error

  @impl Ecto.ParameterizedType
  def equal?(%Decimal{} = val1, %Decimal{} = val2, _), do: Decimal.eq?(val1, val2)

  def equal?(nil, nil, _), do: true
  def equal?(_, _, _), do: false
end
