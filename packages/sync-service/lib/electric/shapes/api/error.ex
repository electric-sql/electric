defmodule Electric.Shapes.Api.Error do
  defstruct [:message, :status]

  @must_refetch %{headers: %{control: "must-refetch"}}

  def must_refetch() do
    %__MODULE__{message: [@must_refetch], status: 409}
  end
end
