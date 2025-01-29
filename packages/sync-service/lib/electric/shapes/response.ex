defmodule Electric.Shapes.Response do
  alias Electric.Shapes.Request

  defstruct [
    :handle,
    :offset,
    :shape,
    up_to_date: false,
    status: 200,
    trace_attrs: %{},
    body: []
  ]

  def error(request, message, args \\ []) do
    opts =
      args
      |> Keyword.put_new(:status, 400)
      |> Keyword.put(:body, Request.encode_message(request, message))

    struct(__MODULE__, opts)
  end
end
