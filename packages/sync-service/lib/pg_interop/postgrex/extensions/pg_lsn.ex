defmodule PgInterop.Postgrex.Extensions.PgLsn do
  use Postgrex.BinaryExtension, send: "pg_lsn_send"
  import Postgrex.BinaryUtils, warn: false

  def encode(_state) do
    quote location: :keep do
      %Electric.Postgres.Lsn{} = lsn ->
        <<8::int32(), Electric.Postgres.Lsn.to_integer(lsn)::uint64()>>

      other ->
        raise DBConnection.EncodeError,
              Postgrex.Utils.encode_msg(other, "a value of type Electric.Postgres.Lsn.t()")
    end
  end

  def decode(_) do
    quote location: :keep do
      <<8::int32(), wal_offset::uint64()>> ->
        Electric.Postgres.Lsn.from_integer(wal_offset)
    end
  end
end
