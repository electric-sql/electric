defmodule Burn.Tool do
  @moduledoc """
  Use Ecto schemas to describe LLM tools.

  ## Example

    defmodule MyApp.Tools.Calculator do
      use Burn.Tool

      @name "calculator"
      @description "Performs basic math operations"

      @primary_key false
      embedded_schema do
        field(:operation, :string)
        field(:x, :float)
        field(:y, :float)
      end
    end

  The name and description are important -- they're passed to the LLM to use
  when deciding what tool to use.

  Define a `c:schema/0` callback to pre-cache and optimise the tool schema,
  including field descriptions and hints.
  """

  @doc """
  Tool name.
  """
  @callback name() :: String.t()

  @doc """
  Tool description.
  """
  @callback description() :: String.t()

  @doc """
  JSON schema for the tool use.
  """
  @callback schema() :: map()

  @doc """
  Represent as a map to send in the tools parameter sent to the LLM.
  """
  @callback param() :: map()

  @doc """
  Validate the LLM response.
  """
  @callback validate(Burn.Threads.Thread.t(), Ecto.Schema.t(), map()) :: Ecto.Changeset.t()

  @doc """
  Perform the tool call.
  """
  @callback perform(Ecto.Multi.t(), Burn.ToolCall.t()) :: Ecto.Multi.t()

  defmacro __before_compile__(%Macro.Env{module: module} = env) do
    name_func =
      unless Module.defines?(module, {:name, 0}) do
        case Module.has_attribute?(module, :name) do
          true ->
            quote do
              @impl Burn.Tool
              def name(), do: @name
            end

          false ->
            raise CompileError,
              description: """
                Module `#{module}` must define a `@name` module attribute or
                a `c:name/0` callback when using `Burn.Tool`.
              """,
              file: env.file,
              line: env.line
        end
      end

    description_func =
      unless Module.defines?(module, {:description, 0}) do
        case Module.has_attribute?(module, :description) do
          true ->
            quote do
              @impl Burn.Tool
              def description(), do: @description
            end

          false ->
            raise CompileError,
              description: """
                Module `#{module}` must define a `@description` module attribute or
                a `c:description/0` callback when using `Burn.Tool`.
              """,
              file: env.file,
              line: env.line
        end
      end

    [name_func, description_func]
  end

  defmacro __using__(_opts) do
    quote do
      use Ecto.Schema
      import Ecto.Changeset

      alias Burn.{
        Memory,
        ToolCall
      }

      @behaviour Burn.Tool
      @before_compile Burn.Tool

      @impl Burn.Tool
      def schema do
        InstructorLite.JSONSchema.from_ecto_schema(__MODULE__)
      end

      @impl Burn.Tool
      def param do
        %{
          name: __MODULE__.name(),
          description: __MODULE__.description(),
          input_schema: schema()
        }
      end

      @impl Burn.Tool
      def perform(multi, _tool_call) do
        multi
      end

      defoverridable schema: 0, param: 0, perform: 2
    end
  end
end
