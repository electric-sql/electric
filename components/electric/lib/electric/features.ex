defmodule Electric.Features do
  @moduledoc """
  Allows for enabling and disabling features via flags. Configurable via:

  1. The standard configuration file:

          config Electric.Features,
             some_feature: true,
             another_feature: false

  2. Via an env variable `ELECTRIC_FEATURES`. This uses a PATH-like syntax,
     where flag settings are separated by colons, e.g. to add or update the
     existing environment configuration with `another_feature` off and
     `some_feature` on, you would do:

          export ELECTRIC_FEATURES="another_feature=false:some_feature=true:${ELECTRIC_FEATURES:-}"

      i.e. values at the start of the env variable have precedence.

  3. Globally at runtime:

          Electric.Features.enable(some_feature: false)

  4. On a per-process basis, e.g. for tests:

          Electric.Features.process_override(some_feature: false)

  These are applied in the above precedence, i.e. the values from the
  environment will override values in the configuration, values set at runtime
  will override values from the environment and finally values set on a process
  will override everything.
  """
  use GenServer

  require Logger

  @default_key :__default__
  @default_env_var "ELECTRIC_FEATURES"

  @type flag() :: atom()
  @type name() :: atom()

  def start_link(args) do
    GenServer.start_link(__MODULE__, args)
  end

  def default_key, do: @default_key

  @doc """
  Is a given feature enabled?
  """
  @spec enabled?(flag(), name()) :: boolean()
  def enabled?(feature, name \\ __MODULE__) do
    case process_get(feature, name) do
      :error ->
        ets_get(feature, name)

      {:ok, enabled?} ->
        enabled?
    end
  end

  @doc """
  Set runtime feature flags. Overrides values from the application
  configuration or the env.
  """
  @spec enable([{flag(), boolean()}], name()) :: :ok
  def enable(flags, name \\ __MODULE__) do
    :ets.insert(name, Enum.to_list(flags))
    :ok
  end

  @doc """
  Configure the feature flags for the current process, overriding any
  existing values for the given flags at the application- or
  process-level.
  """
  @spec process_override([{flag(), boolean()}], name()) :: :ok
  def process_override(features, name \\ __MODULE__) do
    Process.put({__MODULE__, name}, Map.new(features))
    :ok
  end

  @doc """
  Reset the process flags to the global settings.
  """
  @spec process_reset(name()) :: :ok
  def process_reset(name \\ __MODULE__) do
    Process.delete({__MODULE__, name})
    :ok
  end

  def init(args) do
    name = Keyword.get(args, :name, __MODULE__)

    table = :ets.new(name, [:set, :public, :named_table, read_concurrency: true])

    flags =
      %{}
      |> merge(Keyword.get(args, :flags, []))
      |> merge(application_configuration(name))
      |> merge(flags_from_env!(args))

    default_value = Keyword.get(args, :default, false)

    Logger.debug(
      "Got feature flag configuration #{inspect(flags)} with default value: #{default_value}"
    )

    initialise_flag_table(table, flags, default_value)

    {:ok, {name, table}}
  end

  defp merge(original, overrides) do
    Map.merge(original, Map.new(overrides))
  end

  defp application_configuration(name) do
    Application.get_env(:electric, name, [])
  end

  @doc false
  @spec parse_flags!(String.t()) :: %{atom() => boolean()} | no_return()
  def parse_flags!(flag_string) when is_binary(flag_string) do
    flag_string
    |> :binary.split(":", [:global, :trim_all])
    |> Enum.reverse()
    |> Stream.map(&:binary.split(&1, "="))
    |> Map.new(fn [k, v] -> {String.to_atom(k), to_bool(v)} end)
  end

  defp to_bool("true"), do: true
  defp to_bool("false"), do: false

  defp flags_from_env!(args) do
    env_var = Keyword.get(args, :env_var, @default_env_var)
    Logger.debug("Loading flag string from env #{env_var}")
    flag_string = System.get_env(env_var, "")
    parse_flags!(flag_string)
  end

  defp initialise_flag_table(table, flags, default_value) do
    :ets.insert(table, [{@default_key, default_value} | Enum.to_list(flags)])
  end

  defp ets_get(feature, name) do
    case :ets.lookup(name, feature) do
      [{^feature, enabled?}] -> enabled?
      [] -> ets_get(@default_key, name)
    end
  end

  defp process_get(feature, name) do
    with flags when is_map(flags) <- Process.get({__MODULE__, name}, :error) do
      Map.fetch(flags, feature)
    end
  end
end
