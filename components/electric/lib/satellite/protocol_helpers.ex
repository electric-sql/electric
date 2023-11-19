defmodule Satellite.ProtocolHelpers do
  @moduledoc """
  Helper module for building protobuf objects to send via the test WS client.
  Used mainly in E2E tests, which is why this is not in the test folder.
  """
  use Electric.Satellite.Protobuf
  alias Electric.Satellite.Serialization

  @entries_relation_oid 11111
  @camelCase_relation_oid 134

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
      oid: @entries_relation_oid,
      primary_keys: ["id"],
      columns: [
        replication_col("id", :uuid),
        replication_col("content", :varchar),
        replication_col("content_b", :varchar)
      ]
    }
  end

  def schema("public.camelCase") do
    %{
      schema: "public",
      name: "camelCase",
      oid: @camelCase_relation_oid,
      primary_keys: ["id"],
      columns: [
        replication_col("id", :text),
        replication_col("userId", :text)
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
      relation_id: @entries_relation_oid,
      schema_name: "public",
      table_name: "entries",
      table_type: :TABLE
    }
  end

  def relation("public.camelCase") do
    %SatRelation{
      columns: [
        %SatRelationColumn{name: "id", type: "text", is_nullable: false},
        %SatRelationColumn{name: "userId", type: "text", is_nullable: true}
      ],
      relation_id: @camelCase_relation_oid,
      schema_name: "public",
      table_name: "camelCase",
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

  @default_types %{
    "bool" => %{oid: 16, kind: :BASE},
    "int2" => %{oid: 21, kind: :BASE},
    "int4" => %{oid: 23, kind: :BASE},
    "int8" => %{oid: 20, kind: :BASE},
    "text" => %{oid: 25, kind: :BASE},
    "float4" => %{oid: 700, kind: :BASE},
    "float8" => %{oid: 701, kind: :BASE},
    "date" => %{oid: 1082, kind: :BASE},
    "time" => %{oid: 1083, kind: :BASE},
    "timestamp" => %{oid: 1114, kind: :BASE},
    "timestamptz" => %{oid: 1184, kind: :BASE},
    "varchar" => %{oid: 1043, kind: :BASE},
    "uuid" => %{oid: 2950, kind: :BASE},
    "electric.tag" => %{oid: 0, kind: :DOMAIN}
  }

  def default_types, do: @default_types

  def replication_col(name, type_name, overrides \\ []) do
    %Electric.Postgres.Replication.Column{
      name: name,
      type: replication_col_type(type_name)
    }
    |> Map.merge(Map.new(overrides))
  end

  def replication_col_type(name, overrides \\ []) do
    base_info = %{name: name, modifier: -1, values: []}

    case Map.fetch(@default_types, to_string(name)) do
      {:ok, map} -> Map.merge(base_info, map)
      :error -> base_info
    end
    |> Map.merge(Map.new(overrides))
  end
end
