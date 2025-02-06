defmodule Electric.Phoenix.Plug.Shapes do
  defmacro __using__(opts \\ []) do
    path = Keyword.get(opts, :path, "/")

    quote do
      alias Electric.Phoenix.Plug.Shapes.PassAssignToOptsPlug

      get(unquote(path),
        to: PassAssignToOptsPlug,
        init_opts: [plug: Electric.Plug.ServeShapePlug, assign_key: :config]
      )

      delete(unquote(path),
        to: PassAssignToOptsPlug,
        init_opts: [plug: Electric.Plug.DeleteShapePlug, assign_key: :config]
      )

      options(unquote(path), to: Electric.Plug.OptionsShapePlug)
    end
  end

  defmodule PassAssignToOptsPlug do
    @behaviour Plug

    def init(plug: plug, assign_key: key) when is_atom(plug) do
      {plug, key}
    end

    def call(conn, {plug, key}) do
      config = Map.new(dbg(get_in(conn.assigns, [key, :electric])))
      plug.call(conn, plug.init(config))
    end
  end

  @behaviour Plug

  def init(config) do
    config
  end

  def call(%{private: %{phoenix_endpoint: endpoint}} = conn, config) do
    config = endpoint.config(:electric)
    Electric.Plug.ServeShapePlug.call(conn, config)
  end
end
