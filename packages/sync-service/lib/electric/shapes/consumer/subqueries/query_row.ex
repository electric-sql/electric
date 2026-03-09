defmodule Electric.Shapes.Consumer.Subqueries.QueryRow do
  @moduledoc false

  @enforce_keys [:key, :json]
  defstruct [:key, :json]

  @type t() :: %__MODULE__{
          key: String.t(),
          json: iodata()
        }
end
