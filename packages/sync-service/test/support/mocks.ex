defmodule Support.Mock do
  defmacro __using__(_args) do
    quote do
      Mox.defmock(__MODULE__.Mock.Storage,
        for: Code.ensure_compiled!(Electric.ShapeCache.Storage)
      )

      Mox.defmock(__MODULE__.Mock.ShapeCache,
        for: Code.ensure_compiled!(Electric.ShapeCacheBehaviour)
      )

      Mox.defmock(__MODULE__.Mock.Inspector,
        for: Code.ensure_compiled!(Electric.Postgres.Inspector)
      )

      Mox.defmock(__MODULE__.Mock.ShapeStatus,
        for: Code.ensure_compiled!(Electric.ShapeCache.ShapeStatusBehaviour)
      )

      Mox.defmock(__MODULE__.Mock.PersistentKV, for: Code.ensure_compiled!(Electric.PersistentKV))

      alias __MODULE__.Mock
    end
  end
end
