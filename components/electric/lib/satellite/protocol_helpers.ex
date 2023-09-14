defmodule Satellite.ProtocolHelpers do
  @moduledoc """
  Helper module for building protobuf objects to send via the test WS client.
  Used mainly in E2E tests, which is why this is not in the test folder.
  """
  use Electric.Satellite.Protobuf
  alias Electric.Satellite.Serialization

  def subscription_request(id \\ nil, shape_requests) do
    shape_requests
    |> Enum.map(fn
      {id, tables: tables} ->
        %SatShapeReq{
          request_id: to_string(id),
          shape_definition: %SatShapeDef{
            selects: tables |> Enum.map(&%SatShapeDef.Select{tablename: &1})
          }
        }
    end)
    |> then(
      &%SatSubsReq{
        subscription_id: id || Electric.Utils.uuid4(),
        shape_requests: &1
      }
    )
  end

  def schema("public.entries") do
    %{
      schema: "public",
      name: "entries",
      oid: 11111,
      primary_keys: ["id"],
      columns: [
        %{name: "id", type: :uuid},
        %{name: "content", type: :varchar},
        %{name: "content_b", type: :varchar}
      ]
    }
  end

  def relation("public.entries") do
    %SatRelation{
      columns: [
        %SatRelationColumn{name: "id", type: "uuid", is_nullable: false},
        %SatRelationColumn{name: "content", type: "varchar", is_nullable: false},
        %SatRelationColumn{name: "content_b", type: "varchar", is_nullable: true}
      ],
      relation_id: 11111,
      schema_name: "public",
      table_name: "entries",
      table_type: :TABLE
    }
  end

  def insert(table, data) when is_map(data) do
    schema = schema(table)
    columns = schema.columns
    %SatOpInsert{relation_id: schema.oid, row_data: Serialization.map_to_row(data, columns)}
  end

  def update(table, pk, old_data, new_data, tags \\ [])
      when is_list(tags) and is_map(pk) and is_map(old_data) and is_map(new_data) do
    schema = schema(table)
    columns = schema.columns

    %SatOpUpdate{
      relation_id: schema.oid,
      old_row_data: Serialization.map_to_row(Map.merge(old_data, pk), columns),
      row_data: Serialization.map_to_row(Map.merge(new_data, pk), columns),
      tags: tags
    }
  end

  def delete(table, old_data, tags \\ []) when is_list(tags) and is_map(old_data) do
    schema = schema(table)
    columns = schema.columns

    %SatOpDelete{
      relation_id: schema.oid,
      old_row_data: Serialization.map_to_row(old_data, columns),
      tags: tags
    }
  end

  def transaction(lsn, commit_time, op_or_ops)
      when is_binary(lsn) and (is_integer(commit_time) or is_struct(commit_time, DateTime)) do
    commit_time =
      if is_integer(commit_time),
        do: commit_time,
        else: DateTime.to_unix(commit_time, :millisecond)

    begin = {:begin, %SatOpBegin{commit_timestamp: commit_time, lsn: lsn, trans_id: ""}}
    commit = {:commit, %SatOpCommit{commit_timestamp: commit_time, lsn: lsn, trans_id: ""}}
    ops = [begin] ++ List.wrap(op_or_ops) ++ [commit]

    ops =
      Enum.map(ops, fn
        {type, op} -> %SatTransOp{op: {type, op}}
        %SatOpInsert{} = op -> %SatTransOp{op: {:insert, op}}
        %SatOpUpdate{} = op -> %SatTransOp{op: {:update, op}}
        %SatOpDelete{} = op -> %SatTransOp{op: {:delete, op}}
      end)

    %SatOpLog{ops: ops}
  end
end
