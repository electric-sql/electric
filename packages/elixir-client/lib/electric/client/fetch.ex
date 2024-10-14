defmodule Electric.Client.Fetch do
  @callback fetch(Request.t(), Keyword.t()) :: :ok
end
