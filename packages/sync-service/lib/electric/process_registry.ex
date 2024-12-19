defmodule Electric.ProcessRegistry do
  @spec child_spec([Registry.start_option()]) :: Supervisor.child_spec()
  def child_spec(options) do
    %{
      id: __MODULE__,
      start: {__MODULE__, :start_link, [options]},
      type: :supervisor
    }
  end

  def start_link(opts) do
    opts =
      opts
      |> Keyword.put_new(:name, registry_name(Keyword.fetch!(opts, :stack_id)))
      |> Keyword.put(:keys, :unique)

    Registry.start_link(opts)
  end

  def registry_name(stack_id) when is_atom(stack_id) or is_binary(stack_id),
    do: :"#{__MODULE__}:#{stack_id}"

  def name(stack_id, key, sub_key \\ nil) when not is_nil(stack_id) do
    {:via, Registry, {registry_name(stack_id), {key, sub_key}}}
  end

  def alive?(stack_id, key, sub_key \\ nil) do
    case GenServer.whereis(name(stack_id, key, sub_key)) do
      nil -> false
      _ -> true
    end
  rescue
    # if the registry is not started, whereis will raise - we can
    # assume that the process is not alive
    ArgumentError -> false
  end
end
