defmodule Electric.Replication.Config do
  @moduledoc """
  Replication config helpers.
  """

  def config do
    Application.get_env(:electric, Electric.Replication)
  end

  def pg_client do
    config()
    |> Keyword.get(:pg_client)
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
