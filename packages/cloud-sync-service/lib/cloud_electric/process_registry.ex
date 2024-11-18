defmodule CloudElectric.ProcessRegistry do
  @spec child_spec([Registry.start_option()]) :: Supervisor.child_spec()
  def child_spec(options) do
    options =
      options
      |> Keyword.put(:keys, :unique)
      |> Keyword.put(:name, __MODULE__)

    %{
      id: Keyword.get(options, :name, Registry),
      start: {__MODULE__, :start_link, [options]},
      type: :supervisor
    }
  end

  def start_link(opts), do: Registry.start_link(opts)

  def name(key, sub_key \\ nil) do
    {:via, Registry, {__MODULE__, {key, sub_key}}}
  end
end
