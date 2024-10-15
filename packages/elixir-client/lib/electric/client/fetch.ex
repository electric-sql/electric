defmodule Electric.Client.Fetch do
  alias Electric.Client.Fetch.{Request, Response}

  @callback fetch(Request.t(), Keyword.t()) ::
              {:ok, Response.t()}
              | {:error, Response.t() | term()}
end
