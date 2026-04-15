defmodule Electric.LiveDashboard.ErrorView do
  @moduledoc """
  Error view for the LiveDashboard endpoint.
  Handles rendering of HTTP errors.
  """

  def render(template, _assigns) do
    Phoenix.Controller.status_message_from_template(template)
  end
end
