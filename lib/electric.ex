defmodule Electric do
  @moduledoc false

  @type reg_name :: {:via, :gproc, {:n, :l, term()}}

  @doc """
  Register process with the given name
  """
  def reg({:via, :gproc, name}) do
    :gproc.reg(name)
  end

  @doc """
  Helper function for gproc registration
  """
  @spec name(module(), term()) :: reg_name
  def name(module, term) do
    {:via, :gproc, {:n, :l, {module, term}}}
  end

  @doc """
  Helper function to lookup pid that corresponds to registered gproc name
  """
  @spec lookup_pid(reg_name()) :: pid()
  def lookup_pid({:via, :gproc, name}) do
    :gproc.lookup_pid(name)
  end

  @spec reg_names(module()) :: [String.t()]
  def reg_names(module) do
    :gproc.select(
      {:l, :n},
      [{{{:n, :l, {module, :"$1"}}, :_, :_}, [], [:"$1"]}]
    )
  end

  @doc """
  Every electric cluster belongs to a particular console database instance

  This is that database instance slug
  """
  @spec global_cluster_id() :: binary | no_return
  def global_cluster_id do
    Application.fetch_env!(:electric, :global_cluster_id)
  end
end
