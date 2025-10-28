defmodule Electric.Shapes.FilterPropertyTest do
  use ExUnit.Case
  use ExUnitProperties

  alias Electric.Replication.Changes.{NewRecord, DeletedRecord, UpdatedRecord, Transaction}
  alias Electric.Shapes.{Filter, Shape, ShapeBitmap, RoaringBitmap}
  alias Support.StubInspector

  @moduletag :property_test
  @moduletag timeout: 120_000

  @inspector StubInspector.new(
               tables: ["t1", "t2", "t3"],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0},
                 %{name: "value", type: "int8"},
                 %{name: "status", type: "text"},
                 %{name: "tags", array_type: "text"}
               ]
             )

  # Generator for simple WHERE clauses
  defp where_clause_gen do
    one_of([
      # Equality predicates
      gen all(col <- member_of(["id", "value"]), val <- integer(1..100)) do
        "#{col} = #{val}"
      end,
      # IN predicates
      gen all(col <- member_of(["id", "value"]), vals <- list_of(integer(1..100), min_length: 1, max_length: 5)) do
        "#{col} IN (#{Enum.join(vals, ",")})"
      end,
      # Simple AND predicates
      gen all(val1 <- integer(1..50), val2 <- integer(51..100)) do
        "id >= #{val1} AND id <= #{val2}"
      end,
      # String equality
      gen all(status <- member_of(["active", "pending", "completed"])) do
        "status = '#{status}'"
      end
    ])
  end

  # Generator for shape definitions
  defp shape_gen do
    gen all(
          table <- member_of(["t1", "t2", "t3"]),
          where <- where_clause_gen()
        ) do
      {table, where}
    end
  end

  # Generator for records
  defp record_gen do
    gen all(
          id <- integer(1..100),
          value <- integer(1..100),
          status <- member_of(["active", "pending", "completed", "cancelled"])
        ) do
      %{
        "id" => to_string(id),
        "value" => to_string(value),
        "status" => status
      }
    end
  end

  describe "bitmap vs MapSet equivalence" do
    property "affected_shapes returns same results as affected_shapes_bitmap (converted)" do
      check all(
              shapes <- list_of(shape_gen(), min_length: 5, max_length: 50),
              records <- list_of(record_gen(), min_length: 1, max_length: 20)
            ) do
        # Build filter with generated shapes
        filter =
          shapes
          |> Enum.with_index()
          |> Enum.reduce(Filter.new(), fn {{{table, where}, idx}, acc} ->
            shape_id = "shape_#{idx}"

            case Shape.new(table, where: where, inspector: @inspector) do
              {:ok, shape} -> Filter.add_shape(acc, shape_id, shape)
              {:error, _} -> acc
            end
          end)

        # Test each record
        for record <- records do
          txn = %Transaction{
            changes: [%NewRecord{relation: {"public", "t1"}, record: record}]
          }

          # Get results from both APIs
          mapset_result = Filter.affected_shapes(filter, txn)
          bitmap_result = Filter.affected_shapes_bitmap(filter, txn)

          # Convert bitmap to MapSet
          bitmap_as_mapset = ShapeBitmap.to_handles(filter.shape_bitmap, bitmap_result)

          # They must be equivalent
          assert mapset_result == bitmap_as_mapset,
                 """
                 Bitmap and MapSet results differ for record: #{inspect(record)}
                 MapSet: #{inspect(mapset_result)}
                 Bitmap: #{inspect(bitmap_as_mapset)}
                 """
        end
      end
    end

    property "add/remove shapes maintains consistency" do
      check all(
              initial_shapes <- list_of(shape_gen(), min_length: 10, max_length: 30),
              operations <- list_of(
                one_of([
                  {:add, shape_gen()},
                  {:remove, integer(0..29)}
                ]),
                min_length: 5,
                max_length: 20
              ),
              record <- record_gen()
            ) do
        # Build initial filter
        initial_filter =
          initial_shapes
          |> Enum.with_index()
          |> Enum.reduce(Filter.new(), fn {{{table, where}, idx}, acc} ->
            shape_id = "shape_#{idx}"

            case Shape.new(table, where: where, inspector: @inspector) do
              {:ok, shape} -> Filter.add_shape(acc, shape_id, shape)
              {:error, _} -> acc
            end
          end)

        # Apply operations
        {filter, shape_ids} =
          Enum.reduce(operations, {initial_filter, Enum.to_list(0..(length(initial_shapes) - 1))}, fn
            {:add, {table, where}}, {filt, ids} ->
              new_id = length(ids)
              shape_id = "shape_#{new_id}"

              case Shape.new(table, where: where, inspector: @inspector) do
                {:ok, shape} -> {Filter.add_shape(filt, shape_id, shape), ids ++ [new_id]}
                {:error, _} -> {filt, ids}
              end

            {:remove, idx}, {filt, ids} ->
              if idx < length(ids) and Enum.at(ids, idx) != nil do
                shape_id = "shape_#{Enum.at(ids, idx)}"
                {Filter.remove_shape(filt, shape_id), List.delete_at(ids, idx)}
              else
                {filt, ids}
              end
          end)

        # Test consistency after operations
        txn = %Transaction{
          changes: [%NewRecord{relation: {"public", "t1"}, record: record}]
        }

        mapset_result = Filter.affected_shapes(filter, txn)
        bitmap_result = Filter.affected_shapes_bitmap(filter, txn)
        bitmap_as_mapset = ShapeBitmap.to_handles(filter.shape_bitmap, bitmap_result)

        assert mapset_result == bitmap_as_mapset,
               """
               After add/remove operations, results differ
               MapSet: #{inspect(mapset_result)}
               Bitmap: #{inspect(bitmap_as_mapset)}
               Record: #{inspect(record)}
               """
      end
    end

    property "multiple changes in transaction handled correctly" do
      check all(
              shapes <- list_of(shape_gen(), min_length: 5, max_length: 20),
              changes <- list_of(
                one_of([
                  {:insert, record_gen()},
                  {:update, record_gen(), record_gen()},
                  {:delete, record_gen()}
                ]),
                min_length: 1,
                max_length: 10
              )
            ) do
        # Build filter
        filter =
          shapes
          |> Enum.with_index()
          |> Enum.reduce(Filter.new(), fn {{{table, where}, idx}, acc} ->
            shape_id = "shape_#{idx}"

            case Shape.new(table, where: where, inspector: @inspector) do
              {:ok, shape} -> Filter.add_shape(acc, shape_id, shape)
              {:error, _} -> acc
            end
          end)

        # Build transaction with multiple changes
        txn_changes =
          Enum.map(changes, fn
            {:insert, record} ->
              %NewRecord{relation: {"public", "t1"}, record: record}

            {:update, new_rec, old_rec} ->
              %UpdatedRecord{relation: {"public", "t1"}, record: new_rec, old_record: old_rec}

            {:delete, record} ->
              %DeletedRecord{relation: {"public", "t1"}, old_record: record}
          end)

        txn = %Transaction{changes: txn_changes}

        mapset_result = Filter.affected_shapes(filter, txn)
        bitmap_result = Filter.affected_shapes_bitmap(filter, txn)
        bitmap_as_mapset = ShapeBitmap.to_handles(filter.shape_bitmap, bitmap_result)

        assert mapset_result == bitmap_as_mapset,
               """
               Multi-change transaction results differ
               MapSet: #{inspect(mapset_result)}
               Bitmap: #{inspect(bitmap_as_mapset)}
               Changes: #{length(txn_changes)}
               """
      end
    end
  end

  describe "RoaringBitmap operations" do
    property "from_list and to_list roundtrip" do
      check all(values <- list_of(integer(0..10000), min_length: 0, max_length: 1000)) do
        unique_sorted = values |> Enum.uniq() |> Enum.sort()

        bitmap = RoaringBitmap.from_list(values)
        result = RoaringBitmap.to_list(bitmap)

        assert result == unique_sorted
      end
    end

    property "union is associative and commutative" do
      check all(
              list1 <- list_of(integer(0..1000), max_length: 100),
              list2 <- list_of(integer(0..1000), max_length: 100),
              list3 <- list_of(integer(0..1000), max_length: 100)
            ) do
        b1 = RoaringBitmap.from_list(list1)
        b2 = RoaringBitmap.from_list(list2)
        b3 = RoaringBitmap.from_list(list3)

        # Associative: (a ∪ b) ∪ c = a ∪ (b ∪ c)
        left_assoc = RoaringBitmap.union(RoaringBitmap.union(b1, b2), b3) |> RoaringBitmap.to_list()
        right_assoc = RoaringBitmap.union(b1, RoaringBitmap.union(b2, b3)) |> RoaringBitmap.to_list()
        assert left_assoc == right_assoc

        # Commutative: a ∪ b = b ∪ a
        union_ab = RoaringBitmap.union(b1, b2) |> RoaringBitmap.to_list()
        union_ba = RoaringBitmap.union(b2, b1) |> RoaringBitmap.to_list()
        assert union_ab == union_ba
      end
    end

    property "intersection is associative and commutative" do
      check all(
              list1 <- list_of(integer(0..1000), max_length: 100),
              list2 <- list_of(integer(0..1000), max_length: 100),
              list3 <- list_of(integer(0..1000), max_length: 100)
            ) do
        b1 = RoaringBitmap.from_list(list1)
        b2 = RoaringBitmap.from_list(list2)
        b3 = RoaringBitmap.from_list(list3)

        # Associative
        left_assoc = RoaringBitmap.intersection(RoaringBitmap.intersection(b1, b2), b3) |> RoaringBitmap.to_list()
        right_assoc = RoaringBitmap.intersection(b1, RoaringBitmap.intersection(b2, b3)) |> RoaringBitmap.to_list()
        assert left_assoc == right_assoc

        # Commutative
        inter_ab = RoaringBitmap.intersection(b1, b2) |> RoaringBitmap.to_list()
        inter_ba = RoaringBitmap.intersection(b2, b1) |> RoaringBitmap.to_list()
        assert inter_ab == inter_ba
      end
    end

    property "union_many equals chained union" do
      check all(lists <- list_of(list_of(integer(0..1000), max_length: 50), min_length: 1, max_length: 10)) do
        bitmaps = Enum.map(lists, &RoaringBitmap.from_list/1)

        # Using union_many
        result_bulk = RoaringBitmap.union_many(bitmaps) |> RoaringBitmap.to_list()

        # Using chained union
        result_chained =
          Enum.reduce(bitmaps, RoaringBitmap.new(), &RoaringBitmap.union/2)
          |> RoaringBitmap.to_list()

        assert result_bulk == result_chained
      end
    end
  end
end
