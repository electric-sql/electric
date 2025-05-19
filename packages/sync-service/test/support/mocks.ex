defmodule Support.Mock do
  defmacro __using__(_args) do
    quote do
      Mox.defmock(__MODULE__.Mock.Storage, for: Electric.ShapeCache.Storage)
      Mox.defmock(__MODULE__.Mock.ShapeCache, for: Electric.ShapeCacheBehaviour)
      Mox.defmock(__MODULE__.Mock.Inspector, for: Electric.Postgres.Inspector)
      Mox.defmock(__MODULE__.Mock.ShapeStatus, for: Electric.ShapeCache.ShapeStatusBehaviour)
      Mox.defmock(__MODULE__.Mock.PersistentKV, for: Electric.PersistentKV)

      Mox.defmock(__MODULE__.Mock.PublicationManager,
        for: Electric.Replication.PublicationManager
      )

      alias __MODULE__.Mock
    end
  end
end
