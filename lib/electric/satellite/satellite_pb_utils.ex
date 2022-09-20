defmodule Electric.Satellite.PB.Utils do
  alias Electric.Satellite.{
    SatErrorResp,
    SatAuthReq,
    SatAuthResp,
    SatGetServerInfoReq,
    SatGetServerInfoResp,
    SatPingReq,
    SatPingResp,
    SatInStartReplicationReq,
    SatInStartReplicationResp,
    SatInStopReplicationReq,
    SatInStopReplicationResp,
    SatOpLog,
    SatRelation,
    SatRelationColumn
  }

  @mapping %{
    SatErrorResp => 0,
    SatAuthReq => 1,
    SatAuthResp => 2,
    SatGetServerInfoReq => 3,
    SatGetServerInfoResp => 4,
    SatPingReq => 5,
    SatPingResp => 6,
    SatInStartReplicationReq => 7,
    SatInStartReplicationResp => 8,
    SatInStopReplicationReq => 9,
    SatInStopReplicationResp => 10,
    SatOpLog => 11,
    SatRelation => 12
  }

  @type relation_id() :: non_neg_integer()
  @type sq_pb_msg() ::
          %SatErrorResp{}
          | %SatAuthReq{}
          | %SatAuthResp{}
          | %SatGetServerInfoReq{}
          | %SatGetServerInfoResp{}
          | %SatPingReq{}
          | %SatPingResp{}
          | %SatInStartReplicationReq{}
          | %SatInStartReplicationResp{}
          | %SatInStopReplicationReq{}
          | %SatInStopReplicationResp{}
          | %SatOpLog{}
          | %SatRelation{}
          | %SatRelationColumn{}

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
      end
    end
  end

  def encode_with_type(msg) do
    {:ok, type, iodata} = encode(msg)
    {:ok, [<<type::size(8)>> | iodata]}
  end
end
