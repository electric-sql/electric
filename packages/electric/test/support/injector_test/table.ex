defmodule Electric.Proxy.InjectorTest.Table do
  defstruct [:name, schema: "public", columns: []]
end

defmodule Electric.Proxy.InjectorTest.Column do
  defstruct [:name, :type]
end
