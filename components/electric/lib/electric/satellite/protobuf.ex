defmodule Electric.Satellite.Protobuf do
  # This is a version provided in the corresponding protocol buffer file
  # Make sure to bump it here and in the using macro below.

  import Electric.Satellite.V12

  alias Electric.Satellite.V12.{
    SatErrorResp,
    SatAuthReq,
    SatAuthResp,
    SatPingReq,
    SatPingResp,
    SatInStartReplicationReq,
    SatInStartReplicationResp,
    SatInStopReplicationReq,
    SatInStopReplicationResp,
    SatOpLog,
    SatRelation,
    SatMigrationNotification
  }

  require Logger

  # This mapping should be kept in sync with Satellite repo. Message is present
  # in the mapping ONLY if it could be send as an individual message.
  @mapping %{
    SatErrorResp => 0,
    SatAuthReq => 1,
    SatAuthResp => 2,
    SatPingReq => 3,
    SatPingResp => 4,
    SatInStartReplicationReq => 5,
    SatInStartReplicationResp => 6,
    SatInStopReplicationReq => 7,
    SatInStopReplicationResp => 8,
    SatOpLog => 9,
    SatRelation => 10,
    SatMigrationNotification => 11
  }

  @type relation_id() :: non_neg_integer()
  @type sq_pb_msg() ::
          %SatErrorResp{}
          | %SatAuthReq{}
          | %SatAuthResp{}
          | %SatPingReq{}
          | %SatPingResp{}
          | %SatInStartReplicationReq{}
          | %SatInStartReplicationResp{}
          | %SatInStopReplicationReq{}
          | %SatInStopReplicationResp{}
          | %SatOpLog{}
          | %SatRelation{}
          | %SatMigrationNotification{}

  defmacro __using__(_opts) do
    quote do
      alias Electric.Satellite.Protobuf, as: PB

      alias Electric.Satellite.V12.{
        SatErrorResp,
        SatAuthReq,
        SatAuthHeaderPair,
        SatAuthResp,
        SatPingReq,
        SatPingResp,
        SatInStartReplicationReq,
        SatInStartReplicationResp,
        SatInStopReplicationReq,
        SatInStopReplicationResp,
        SatOpLog,
        SatOpRow,
        SatOpBegin,
        SatOpCommit,
        SatOpDelete,
        SatOpInsert,
        SatOpUpdate,
        SatTransOp,
        SatRelation,
        SatRelationColumn,
        SatMigrationNotification
      }
    end
  end

  defmodule Version do
    defstruct major: nil, minor: nil

    @type t() :: %__MODULE__{
            major: integer,
            minor: integer
          }
  end

  @spec decode(byte(), binary()) :: {:ok, sq_pb_msg()} | {:error, any()}
  for {module, tag} <- @mapping do
    def decode(unquote(tag), binary) do
      Protox.decode(binary, unquote(module))
    end
  end

  def decode(_, _) do
    {:error, :unknown_msg_type}
  end

  @spec json_decode(byte(), binary(), list()) :: {:ok, sq_pb_msg()} | {:error, any()}
  for {module, tag} <- @mapping do
    def json_decode(unquote(tag), binary, opts) do
      Protox.json_decode(binary, unquote(module), opts)
    end
  end

  def json_decode(_, _, _) do
    {:error, :unknown_msg_type}
  end

  @spec encode(struct()) :: {:ok, integer(), iodata()} | {:error, any()}
  for {module, tag} <- @mapping do
    def encode(%unquote(module){} = data) do
      with {:ok, encoded} <- Protox.encode(data) do
        {:ok, unquote(tag), encoded}
      else
        error ->
          Logger.warn("failed to encode: #{inspect(data)}")
          error
      end
    end
  end

  def encode_with_type(msg) do
    {:ok, type, iodata} = encode(msg)
    {:ok, [<<type::size(8)>> | iodata]}
  end

  @spec get_long_proto_vsn() :: String.t()
  def get_long_proto_vsn() do
    package()
  end

  @spec get_proto_vsn() :: {:ok, Version.t()} | {:error, term()}
  def get_proto_vsn() do
    parse_proto_vsn(package())
  end

  @doc """
    Version is expected to be of the following format:
    "Namespace.vMajor_Minor"
    where:
      - Namespace is one or multiple napespaces joined by dot
      - MAJOR is a major version, integers only
      - MINOR is a minor version, integers only
  """
  @spec parse_proto_vsn(String.t()) :: {:ok, Version.t()} | {:error, term()}
  def parse_proto_vsn(version) do
    try do
      version =
        version
        |> String.split(".")
        |> List.last()

      parse = Regex.named_captures(~r/^v(?<major>\d*)_(?<minor>\d*)$/, version)

      {:ok,
       %Version{
         major: String.to_integer(parse["major"]),
         minor: String.to_integer(parse["minor"])
       }}
    rescue
      _ ->
        Logger.warn("failed to encode: #{inspect(version)}")
        {:error, :bad_version}
    end
  end

  @doc """
    Check if client's version of protocol is compatible with current version
  """
  @spec is_compatible(Version.t(), Version.t()) :: boolean()
  def is_compatible(
        %Version{major: srv_maj, minor: srv_min},
        %Version{major: cli_maj, minor: cli_min}
      ) do
    srv_maj == cli_maj and srv_min >= cli_min
  end
end
