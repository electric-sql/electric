defmodule Electric do
  @moduledoc false

  @type reg_name :: {:via, :gproc, {:n, :l, term()}}

  @doc """
  Register process with the given name
  """
  def reg({:via, :gproc, name}) do
    :gproc.reg(name)
  end

  def safe_reg({:via, :gproc, name}, timeout) do
    try do
      :gproc.reg(name)
    rescue
      _ ->
        case timeout do
          0 ->
            {:error, :already_registered}

          _ ->
            ref = :gproc.monitor(name)

            receive do
              {:gproc, :unreg, ^ref, _} ->
                safe_reg({:via, :gproc, name}, 0)
            after
              timeout ->
                {:error, :already_registered}
            end
        end
    end
  end

  @spec reg_or_locate(reg_name(), any()) :: :ok | {:error, :already_registered, {pid(), any()}}
  def reg_or_locate({:via, :gproc, name}, value) do
    this = self()

    case :gproc.reg_or_locate(name, value) do
      {^this, ^value} ->
        :ok

      {other, other_value} ->
        {:error, :already_registered, {other, other_value}}
    end
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
  @spec lookup_pid(reg_name()) :: pid() | nil
  def lookup_pid({:via, :gproc, name}) do
    try do
      :gproc.lookup_pid(name)
    rescue
      _ ->
        nil
    end
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

  This is that database instance id
  """
  @spec instance_id() :: binary | no_return
  def instance_id do
    Application.fetch_env!(:electric, :instance_id)
  end
end
