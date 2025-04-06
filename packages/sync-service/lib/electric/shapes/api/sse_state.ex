defmodule Electric.Shapes.Api.SseState do
  alias Electric.Shapes.Api
  alias Electric.Replication.LogOffset

  defstruct [
    :mode,
    :request,
    :stream,
    :since_offset,
    :last_message_time,
    :keepalive_ref
  ]

  @type t() :: %__MODULE__{
    mode: :receive | :emit | :done,
    request: Api.Request.t(),
    stream: Enumerable.t() | nil,
    since_offset: LogOffset.t(),
    last_message_time: pos_integer(),
    keepalive_ref: reference()
  }
end
