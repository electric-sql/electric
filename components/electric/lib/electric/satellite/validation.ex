defmodule Electric.Satellite.Validation do
  @spec assert_type!(String.t(), atom) :: :ok | no_return
  def assert_type!(_val, _col_type) do
    :ok
  end
end
