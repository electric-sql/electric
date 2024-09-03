defmodule Support.Mock do
  Mox.defmock(Support.Mock.Storage, for: Electric.ShapeCache.Storage)
  Mox.defmock(Support.Mock.ShapeCache, for: Electric.ShapeCacheBehaviour)
  Mox.defmock(Support.Mock.Inspector, for: Electric.Postgres.Inspector)
  Mox.defmock(Support.Mock.ShapeStatus, for: Electric.ShapeCache.ShapeStatusBehaviour)
end
