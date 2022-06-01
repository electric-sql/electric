defmodule Electric.Replication.Config do
  @moduledoc """
  Replication config helpers.
  """

  def config do
    Application.get_env(:electric, Electric.Replication)
  end

  def epgsql do
    config()
    |> Keyword.get(:epgsql)
  end

  def producer do
    config()
    |> Keyword.get(:producer)
  end

  def publication do
    config()
    |> Keyword.get(:publication)
  end

  def slot do
    config()
    |> Keyword.get(:slot)
  end
end
