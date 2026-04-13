defmodule Electric.FaviconController do
  @moduledoc """
  Simple controller to handle favicon requests.
  Returns a 204 No Content response to avoid 500 errors.
  """

  use Phoenix.Controller, formats: [:html]

  def show(conn, _params) do
    send_resp(conn, 204, "")
  end
end
