defmodule Electric do
  @doc """
  Every electric cluster belongs to a particular console database instance

  This is that database instance id
  """
  @spec instance_id() :: binary | no_return
  def instance_id do
    Application.fetch_env!(:electric, :instance_id)
  end

  @type relation :: {schema :: String.t(), table :: String.t()}
end
