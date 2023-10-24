defmodule Electric do
  @moduledoc false

  @type reg_name :: {:via, :gproc, {:n, :l, term()}}
  @type write_mode :: :streaming | :immediate

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

  @doc """
  A wrapper around [`:gproc.reg_or_locate/2`](https://github.com/uwiger/gproc/blob/4ca45e0a97722a418a31eb1753f4e3b953f7fb1d/doc/gproc.md#reg_or_locate2).

  Try registering a unique name, or return existing registration.

  This function tries to register the name `key` with the given `value`. If
  such a registration object already exists, the pid and value of the current
  registration is returned instead.
  """
  @spec reg_or_locate(key :: reg_name(), value :: any()) ::
          :ok | {:error, :already_registered, {pid(), any()}}
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

  @current_vsn Mix.Project.config()[:version] |> Version.parse!()
  def vsn do
    @current_vsn
  end

  def streaming_write_mode? do
    write_mode() == :streaming
  end

  def immediate_write_mode? do
    write_mode() == :immediate
  end

  @spec write_mode :: write_mode
  def write_mode, do: Application.fetch_env!(:electric, :write_mode)
end
