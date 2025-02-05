defmodule Electric.Shapes.Api.Request do
  alias Electric.Shapes.Api
  alias Electric.Replication.LogOffset

  defstruct [
    :chunk_end_offset,
    :handle,
    :last_offset,
    :new_changes_ref,
    :new_changes_pid,
    api: %Api{},
    params: %Api.Params{},
    response: %Api.Response{},
    valid: false
  ]

  @type shape_handle :: Electric.ShapeCacheBehaviour.shape_handle()
  @type t() :: %__MODULE__{
          chunk_end_offset: nil | LogOffset.t(),
          handle: nil | shape_handle(),
          last_offset: nil | LogOffset.t(),
          new_changes_ref: nil | reference(),
          new_changes_pid: nil | pid(),
          api: Api.t(),
          params: Api.Params.t(),
          response: Api.Response.t(),
          valid: boolean()
        }
end
