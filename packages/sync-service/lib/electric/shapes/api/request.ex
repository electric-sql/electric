defmodule Electric.Shapes.Api.Request do
  alias Electric.Shapes.Api
  alias Electric.Replication.LogOffset

  defstruct [
    :chunk_end_offset,
    :handle,
    :last_offset,
    :global_last_seen_lsn,
    :new_changes_ref,
    :new_changes_pid,
    api: %Api{},
    params: %Api.Params{},
    response: %Api.Response{}
  ]

  @type shape_handle :: Electric.shape_handle()
  @type t() :: %__MODULE__{
          chunk_end_offset: nil | LogOffset.t(),
          handle: nil | shape_handle(),
          last_offset: nil | LogOffset.t(),
          global_last_seen_lsn: nil | pos_integer(),
          new_changes_ref: nil | reference(),
          new_changes_pid: nil | pid(),
          api: Api.t(),
          params: Api.Params.t(),
          response: Api.Response.t()
        }

  @spec update_response(t(), (Api.Response.t() -> Api.Response.t())) :: t()
  def update_response(%{response: %Api.Response{} = response} = request, fun) do
    %{request | response: fun.(response)}
  end
end
