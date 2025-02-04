defmodule Electric.Phoenix.Gateway do
  @moduledoc false

  alias Electric.Client
  alias Electric.Client.Fetch
  alias Electric.Client.ShapeDefinition

  @type configuration :: %{
          binary() => binary() | %{binary() => binary()}
        }

  @spec configuration(Electric.Phoenix.shape_definition(), Client.t()) :: configuration()
  def configuration(shape_or_queryable, client \\ Electric.Phoenix.client!())

  @doc """
  Get a client configuration for the given shape or `Ecto` query.

  ## Example

      client = Electric.Client.new!(base_url: "http://localhost:3000")

      # get the configuration of a pre-defined shape
      shape = Electric.Client.shape!("todos", where: "completed = false")
      configuration = Electric.Phoenix.Gateway.configuration(shape, client)

      # or use an Ecto query or schema
      configuration = Electric.Phoenix.Gateway.configuration(MyApp.Todos, client)

  """
  def configuration(%Client.ShapeDefinition{} = shape, %Client{} = client) do
    request = Client.request(client, shape: shape)
    auth_headers = Client.authenticate_shape(client, shape)
    shape_params = ShapeDefinition.params(shape, format: :json)
    url = Fetch.Request.url(request, query: false)

    Map.merge(%{"url" => url, "headers" => auth_headers}, shape_params)
  end

  def configuration(%Ecto.Query{} = query, %Client{} = client) do
    query
    |> Electric.Client.shape!()
    |> configuration(client)
  end

  def configuration(module, %Client{} = client) when is_atom(module) do
    module
    |> Electric.Client.shape!()
    |> configuration(client)
  end
end
