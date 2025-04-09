defmodule Electric.Shapes.Api.Error do
  defstruct [:message, :status]

  def must_refetch() do
    %__MODULE__{
      message: [%{headers: %{control: "must-refetch"}}],
      status: 409
    }
  end
end
