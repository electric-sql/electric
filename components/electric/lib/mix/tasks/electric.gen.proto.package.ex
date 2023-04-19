defmodule Mix.Tasks.Electric.Gen.Proto.Package do
  use Mix.Task

  @shortdoc "Generate file with package information for the proto file"
  @moduledoc """
  Generate an elixir file with function that returns package field from
  the protobuf file if presetn and bakes it in the elixir module

  ## Usage

      mix electric.gen.proto.package --output-path=lib/package_info.ex PROTO_FILE


  Where PROTO_FILE is the path to protobuf file.

  ## Command line options

  * `--output-path` - path to store file, if absent the content would be printed
                      the output
  """

  @options [
    output_path: :string
  ]

  @impl Mix.Task
  def run(args) do
    Logger.configure_backend(:console, level: :info)

    with {opts, [proto_path], []} <- OptionParser.parse(args, strict: @options),
         output_path <- Keyword.get(opts, :output_path, nil),
         :ok <- get_package(proto_path, output_path) do
      :ok
    else
      err ->
        Mix.Shell.IO.error("Error: #{inspect(err)}")
    end
  end

  def get_package(proto_path, output_path) do
    proto_path_exp = Path.expand(proto_path)

    case Protox.Protoc.run([proto_path_exp], nil) do
      {:ok, proto_descriptor} ->
        {:ok, descriptor} = Protox.Google.Protobuf.FileDescriptorSet.decode(proto_descriptor)
        [file] = descriptor.file

        module_output = generate_module(proto_path, file.package)

        case output_path do
          nil ->
            Mix.Shell.IO.info("#{module_output}")

          _ ->
            File.write!(output_path, module_output)
            Mix.Shell.IO.info("Written file: #{output_path}")
        end

        :ok

      {:error, msg} ->
        {:error, msg}
    end
  end

  def generate_module(proto_path, package) do
    module_name =
      package
      |> String.split(".")
      |> Enum.map(&Macro.camelize(&1))
      |> Module.concat()

    module_ast =
      quote do
        defmodule unquote(module_name) do
          @moduledoc false
          @spec package() :: String.t()
          def package(), do: unquote(package)
        end
      end

    # Mix.Shell.IO.info("#{inspect(module_ast)}")

    [
      "# File generated from protobuf file: ",
      proto_path,
      "\n",
      module_ast |> Macro.to_string() |> Code.format_string!(),
      "\n"
    ]
  end
end
