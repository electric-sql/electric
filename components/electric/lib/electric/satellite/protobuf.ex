defmodule Electric.Satellite.Protobuf do
  alias Electric.Satellite

  alias Electric.Satellite.{
    SatErrorResp,
    SatOpLog,
    SatRelation,
    SatSubsDataError,
    SatSubsDataBegin,
    SatSubsDataEnd,
    SatShapeDataBegin,
    SatShapeDataEnd,
    SatRpcRequest,
    SatRpcResponse
  }

  require Logger

  @reserved [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 19, 20]

  # This mapping should be kept in sync with Satellite repo. Message is present
  # in the mapping ONLY if it could be send as an individual message.
  @mapping %{
    SatErrorResp => 0,
    SatOpLog => 9,
    SatRelation => 10,
    SatSubsDataError => 14,
    SatSubsDataBegin => 15,
    SatSubsDataEnd => 16,
    SatShapeDataBegin => 17,
    SatShapeDataEnd => 18,
    SatRpcRequest => 21,
    SatRpcResponse => 22
  }

  if Enum.any?(Map.values(@mapping), &(&1 in @reserved)) do
    raise "Cannot use a reserved value as the message tag"
  end

  with {key, count} <-
         Enum.find(Enum.frequencies(Map.values(@mapping)), &match?({_, count} when count > 1, &1)) do
    raise "Cannot have duplicating value tags: #{key} is used #{count} times"
  end

  # Our generator doesn't generate this mapping, so we're doing this.
  @rpc_calls %{
    "authenticate" => {Satellite.SatAuthReq, Satellite.SatAuthResp},
    "startReplication" => {
      Satellite.SatInStartReplicationReq,
      Satellite.SatInStartReplicationResp
    },
    "stopReplication" => {Satellite.SatInStopReplicationReq, Satellite.SatInStopReplicationResp},
    "subscribe" => {Satellite.SatSubsReq, Satellite.SatSubsResp},
    "unsubscribe" => {Satellite.SatUnsubsReq, Satellite.SatUnsubsResp}
  }
  @allowed_rpc_methods Map.keys(@rpc_calls)

  defguard is_allowed_rpc_method(method) when method in @allowed_rpc_methods

  @type relation_id() :: non_neg_integer()
  @type sq_pb_msg() ::
          %SatErrorResp{}
          | %SatOpLog{}
          | %SatRelation{}
          | %SatSubsDataError{}
          | %SatSubsDataBegin{}
          | %SatSubsDataEnd{}
          | %SatShapeDataBegin{}
          | %SatShapeDataEnd{}
          | %SatRpcRequest{}
          | %SatRpcResponse{}

  @type rpc_req() ::
          %Satellite.SatAuthReq{}
          | %Satellite.SatInStartReplicationReq{}
          | %Satellite.SatInStopReplicationReq{}
          | %Satellite.SatSubsReq{}
          | %Satellite.SatUnsubsReq{}

  @type rpc_resp() ::
          %Satellite.SatAuthResp{}
          | %Satellite.SatInStartReplicationResp{}
          | %Satellite.SatInStopReplicationResp{}
          | %Satellite.SatSubsResp{}
          | %Satellite.SatUnsubsResp{}

  defmacro __using__(_opts) do
    quote do
      alias Electric.Satellite.Protobuf, as: PB

      alias Electric.Satellite.{
        SatErrorResp,
        SatRpcRequest,
        SatRpcResponse,
        SatAuthReq,
        SatAuthHeaderPair,
        SatAuthResp,
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
        SatOpMigrate,
        SatTransOp,
        SatRelation,
        SatRelationColumn,
        SatSubsReq,
        SatSubsResp,
        SatSubsDataBegin,
        SatSubsDataEnd,
        SatSubsDataError,
        SatShapeDataBegin,
        SatShapeDataEnd,
        SatShapeReq,
        SatShapeDef,
        SatUnsubsReq,
        SatUnsubsResp
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

  def decode!(tag, binary) do
    {:ok, msg} = decode(tag, binary)
    msg
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
          Logger.warning("failed to encode: #{inspect(data)}")
          error
      end
    end
  end

  def encode_with_type(msg) do
    {:ok, type, iodata} = encode(msg)
    {:ok, [<<type::size(8)>> | iodata]}
  end

  for {method, {request, _}} <- @rpc_calls do
    def decode_rpc_request(unquote(method), message), do: unquote(request).decode(message)
  end

  for {method, {_, response}} <- @rpc_calls do
    def decode_rpc_response(unquote(method), message), do: unquote(response).decode(message)
  end
end
