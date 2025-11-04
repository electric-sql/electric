defmodule Electric.ProcessRegistry do
  import Electric, only: [is_stack_id: 1]

  @spec child_spec([Registry.start_option()]) :: Supervisor.child_spec()
  def child_spec(options) do
    %{
      id: registry_name(Keyword.fetch!(options, :stack_id)),
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

  def registry_name(stack_id) when is_stack_id(stack_id),
    do: :"#{inspect(__MODULE__)}:#{stack_id}"

  def name(opts_or_stack_id, key, sub_key \\ nil)

  def name(opts, key, sub_key) when is_list(opts) or is_map(opts) do
    opts
    |> Access.fetch!(:stack_id)
    |> name(key, sub_key)
  end

  def name(stack_id, key, sub_key) when is_stack_id(stack_id) do
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
