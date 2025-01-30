defmodule Electric.Shapes.Api.Request do
  alias Electric.Shapes.Api

  defstruct [
    :chunk_end_offset,
    :handle,
    :last_offset,
    :new_changes_ref,
    :new_changes_pid,
    config: %Api.Config{},
    params: %Api.Params{},
    response: %Api.Response{},
    valid: false
  ]
end
