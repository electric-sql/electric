defmodule Electric.ProcessRegistry do
  @spec child_spec([Registry.start_option()]) :: Supervisor.child_spec()
  def child_spec(options) do
    options =
      options
      |> Keyword.put_new(:name, registry_name(Keyword.fetch!(options, :stack_id)))
      |> Keyword.put(:keys, :unique)

    %{
      id: Keyword.get(options, :name, Registry),
      start: {__MODULE__, :start_link, [options]},
      type: :supervisor
    }
  end

  def start_link(opts), do: Registry.start_link(opts)

  def registry_name(stack_id) when is_atom(stack_id) or is_binary(stack_id),
    do: :"#{__MODULE__}:#{stack_id}"

  def name(stack_id, key, sub_key \\ nil) when not is_nil(stack_id) do
    {:via, Registry, {registry_name(stack_id), {key, sub_key}}}
  end
end
