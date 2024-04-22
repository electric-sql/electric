defmodule Electric do
  @moduledoc false

  alias Electric.Replication.Connectors

  @type connector :: Connectors.config() | Connectors.origin()
  @type reg_name :: {:via, :gproc, {:n, :l, term()}}
  @type write_to_pg_mode :: :logical_replication | :direct_writes

  defmacro __using__(proc_type) do
    proc_module = proc_module(proc_type)

    quote do
      use unquote(proc_module)

      alias Electric.Replication.Connectors

      @spec start_link(Connectors.config()) :: Supervisor.on_start()
      def start_link(connector_config) do
        name = static_name(connector_config)
        unquote(proc_module).start_link(__MODULE__, connector_config, name: name)
      end

      @spec reg(Electric.connector()) :: true
      def reg(connector) do
        connector
        |> reg_name()
        |> Electric.reg()
      end

      @spec reg_name(Electric.connector()) :: Electric.reg_name()
      def reg_name(connector) do
        Electric.name(__MODULE__, connector)
      end

      @spec static_name(Electric.connector()) :: atom
      def static_name(connector) do
        Electric.static_name(__MODULE__, connector)
      end

      @spec ets_table_name(Electric.connector()) :: atom
      defp ets_table_name(connector) do
        static_name(connector)
      end

      defoverridable start_link: 1
    end
  end

  defp proc_module(:supervisor), do: Supervisor
  defp proc_module(:gen_server), do: GenServer
  defp proc_module(:gen_stage), do: GenStage

  def static_name(module) do
    String.to_atom(trim_module_name(module))
  end

  def static_name(module, connector) do
    String.to_atom(trim_module_name(module) <> ":" <> origin(connector))
  end

  defp trim_module_name(module) do
    module
    |> inspect()
    |> String.replace_leading("Electric.", "")
  end

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

  def await_reg({:via, :gproc, name}, timeout) do
    :gproc.await(name, timeout)
  end

  @doc """
  Helper function for gproc registration
  """
  @spec name(module, connector) :: reg_name
  def name(module, connector) do
    {:via, :gproc, {:n, :l, {module, origin(connector)}}}
  end

  @spec gen_name(module, term) :: reg_name
  def gen_name(module, term) do
    {:via, :gproc, {:n, :l, {module, term}}}
  end

  @spec origin(connector) :: Connectors.origin()
  def origin(origin) when is_binary(origin), do: origin

  def origin(connector_config) when is_list(connector_config),
    do: Connectors.origin(connector_config)

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

  @spec write_to_pg_mode :: write_to_pg_mode
  def write_to_pg_mode, do: Application.fetch_env!(:electric, :write_to_pg_mode)

  @spec max_clock_drift_seconds :: non_neg_integer
  def max_clock_drift_seconds, do: Application.fetch_env!(:electric, :max_clock_drift_seconds)
end
