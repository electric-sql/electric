defmodule Electric.Postgres.LogicalReplication do
  @moduledoc """
  Provides encoding & decoding of PostgreSQL logical replication binary protocol

  Full description of the underlying binary protocol is available at
  https://www.postgresql.org/docs/current/protocol-logicalrep-message-formats.html
  """

  @doc """
  Decode the binary message produced by PostgreSQL logical replication
  """
  defdelegate decode_message(binary),
    to: Electric.Postgres.LogicalReplication.Decoder,
    as: :decode

  @doc """
  Encode the message back to binary format to be consumed by the postgres logical replication
  """
  defdelegate encode_message(struct),
    to: Electric.Postgres.LogicalReplication.Encoder,
    as: :encode
end
