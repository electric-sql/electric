defmodule PgInterop.Postgrex.Extensions.PgSnapshot do
  use Postgrex.BinaryExtension, send: "pg_snapshot_send"
  import Postgrex.BinaryUtils, warn: false

  def encode(_state) do
    quote location: :keep do
      _ -> raise DBConnection.EncodeError, "encoding of type pg_snapshot not implemented"
    end
  end

  def decode(_) do
    quote location: :keep do
      <<len::int32(), nxip::int32(), xmin::uint64(), xmax::uint64(), rest::binary-size(len - 20)>> ->
        xip_list = for <<xid::uint64() <- rest>>, do: xid
        true = nxip == length(xip_list)
        {xmin, xmax, xip_list}
    end
  end
end
