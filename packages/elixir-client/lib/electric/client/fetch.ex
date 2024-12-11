defmodule Electric.Client.Fetch do
  alias Electric.Client.Fetch.{Request, Response}
  alias Electric.Client

  @callback fetch(Request.t(), Keyword.t()) ::
              {:ok, Response.t()}
              | {:error, Response.t() | term()}

  @behaviour Electric.Client.Fetch.Pool

  def request(client, request, opts \\ [])

  @impl Electric.Client.Fetch.Pool
  def request(%Client{} = client, %Request{} = request, _opts) do
    %{pool: {module, opts}} = client
    apply(module, :request, [client, request, opts])
  end
end
