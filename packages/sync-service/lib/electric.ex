defmodule Electric do
  @doc """
  Every electric cluster belongs to a particular console database instance

  This is that database instance id
  """
  @spec instance_id() :: binary | no_return
  def instance_id do
    Application.get_env(:electric, :instance_id, :default)
  end

  @type relation :: {schema :: String.t(), table :: String.t()}
  @type relation_id :: non_neg_integer()

  @current_vsn Mix.Project.config()[:version]
  def version do
    @current_vsn
  end
end
