defmodule Electric.Integration.OracleOrBranchesAndReproTest do
  @moduledoc """
  Reproduction for OR-of-subqueries AND OR-of-subqueries pattern.

  Exercises DNF decomposition with multiple OR branches ANDed together,
  where each branch contains subqueries or atomic expressions:

    (e1 OR e2) AND (e3 OR e4)

  This decomposes into 4 DNF disjuncts:
    d0 = [e1, e3]
    d1 = [e1, e4]
    d2 = [e2, e3]
    d3 = [e2, e4]

  Move-in/move-out must be correct across all 4 disjuncts simultaneously.

  Uses a schema with two independent parent tables (`category` and `region`)
  referenced via different FK columns (`category_id` and `region_id`) on `item`.
  Each parent table has its own filter columns, so subqueries join on different
  fields and a single parent UPDATE only affects subqueries on that FK dimension.
  This exercises cases where disjuncts share some subqueries but differ on others,
  where FK changes on one column leave the other column's subqueries untouched,
  and where parent changes in different tables interact across shapes.

  Schema:
    category (id, active, tier)    — referenced by item.category_id
    region   (id, climate, priority) — referenced by item.region_id
    item     (id, category_id, region_id, value)

  Subqueries vary across:
    - category_id IN (SELECT id FROM category WHERE ...)
    - region_id   IN (SELECT id FROM region WHERE ...)
    - Atomic predicates on item columns (value, id)
  """
  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
  import Support.IntegrationSetup
  import Support.OracleHarness

  @moduletag :oracle
  @moduletag timeout: :infinity
  @moduletag :tmp_dir

  setup [:with_unique_db, :with_sql_execute]
  setup :with_complete_stack

  setup ctx do
    with_electric_client(ctx, router_opts: [long_poll_timeout: 100])
  end

  # ── Schema ──────────────────────────────────────────────────────────────────
  #
  # category: filter by active (bool) and tier (text)
  #   cat1: active=true,  tier=premium
  #   cat2: active=false, tier=basic
  #   cat3: active=true,  tier=basic
  #
  # region: filter by climate (text) and priority (int)
  #   reg1: climate=tropical,  priority=1
  #   reg2: climate=temperate, priority=2
  #   reg3: climate=arctic,    priority=1
  #
  # item: 6 rows spanning all category × region combos
  #   i1: cat1, reg1, value=v1
  #   i2: cat1, reg2, value=v2
  #   i3: cat2, reg1, value=v3
  #   i4: cat2, reg3, value=v4
  #   i5: cat3, reg2, value=v5
  #   i6: cat3, reg3, value=v6
  #
  @base_sql [
    """
    CREATE TABLE category (
      id TEXT PRIMARY KEY,
      active BOOLEAN NOT NULL DEFAULT true,
      tier TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE region (
      id TEXT PRIMARY KEY,
      climate TEXT NOT NULL,
      priority INT NOT NULL DEFAULT 1
    )
    """,
    """
    CREATE TABLE item (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES category(id),
      region_id TEXT NOT NULL REFERENCES region(id),
      value TEXT NOT NULL
    )
    """,
    """
    INSERT INTO category (id, active, tier) VALUES
      ('cat1', true,  'premium'),
      ('cat2', false, 'basic'),
      ('cat3', true,  'basic')
    """,
    """
    INSERT INTO region (id, climate, priority) VALUES
      ('reg1', 'tropical',  1),
      ('reg2', 'temperate', 2),
      ('reg3', 'arctic',    1)
    """,
    """
    INSERT INTO item (id, category_id, region_id, value) VALUES
      ('i1', 'cat1', 'reg1', 'v1'),
      ('i2', 'cat1', 'reg2', 'v2'),
      ('i3', 'cat2', 'reg1', 'v3'),
      ('i4', 'cat2', 'reg3', 'v4'),
      ('i5', 'cat3', 'reg2', 'v5'),
      ('i6', 'cat3', 'reg3', 'v6')
    """
  ]

  # ── Shapes ──────────────────────────────────────────────────────────────────
  #
  # Shape 1: both OR branches use different FK columns.
  #   (category active OR region tropical) AND (category premium OR region priority=1)
  #   A category change affects only the first slot in each branch; a region
  #   change affects only the second. Disjuncts couple different tables.
  #
  # Shape 2: one branch is all-category, the other is all-region.
  #   (category active OR category basic) AND (region temperate OR region priority=1)
  #   A single category change can flip both slots in the first branch.
  #   A single region change can flip both slots in the second branch.
  #
  # Shape 3: mixed subqueries and atomics across both FKs.
  #   (category inactive OR value >= 'v4') AND (region_id = 'reg1' OR category tier=premium)
  #   Atomic on item.value interacts with category subquery; atomic on
  #   item.region_id interacts with category subquery in the other branch.
  #
  # Shape 4: cross-FK with negation.
  #   (region climate <> 'arctic' OR category basic) AND (category active OR region priority > 1)
  #   <> in subquery creates a wide match; tests move-out when the wide
  #   branch still holds but the narrow one flips.
  #
  @shapes [
    %{
      name: "cross_fk_subqueries",
      table: "item",
      where:
        "(category_id IN (SELECT id FROM category WHERE active = true) OR region_id IN (SELECT id FROM region WHERE climate = 'tropical')) AND (category_id IN (SELECT id FROM category WHERE tier = 'premium') OR region_id IN (SELECT id FROM region WHERE priority = 1))",
      columns: ["id", "category_id", "region_id", "value"],
      pk: ["id"],
      optimized: true
    },
    %{
      name: "same_fk_per_branch",
      table: "item",
      where:
        "(category_id IN (SELECT id FROM category WHERE active = true) OR category_id IN (SELECT id FROM category WHERE tier = 'basic')) AND (region_id IN (SELECT id FROM region WHERE climate = 'temperate') OR region_id IN (SELECT id FROM region WHERE priority = 1))",
      columns: ["id", "category_id", "region_id", "value"],
      pk: ["id"],
      optimized: true
    },
    %{
      name: "mixed_subquery_atomic",
      table: "item",
      where:
        "(category_id IN (SELECT id FROM category WHERE active = false) OR value >= 'v4') AND (region_id = 'reg1' OR category_id IN (SELECT id FROM category WHERE tier = 'premium'))",
      columns: ["id", "category_id", "region_id", "value"],
      pk: ["id"],
      optimized: true
    },
    %{
      name: "cross_fk_with_negation",
      table: "item",
      where:
        "(region_id IN (SELECT id FROM region WHERE climate <> 'arctic') OR category_id IN (SELECT id FROM category WHERE tier = 'basic')) AND (category_id IN (SELECT id FROM category WHERE active = true) OR region_id IN (SELECT id FROM region WHERE priority > 1))",
      columns: ["id", "category_id", "region_id", "value"],
      pk: ["id"],
      optimized: true
    }
  ]

  # ── Mutations ───────────────────────────────────────────────────────────────
  #
  # Batch 1: Category change only — cat1 active->false.
  #          Affects category_id subqueries; region_id subqueries untouched.
  #          i1,i2 lose "active=true" membership.
  #
  # Batch 2: Region change only — reg1 climate tropical->temperate.
  #          Affects region_id subqueries; category_id subqueries untouched.
  #          i1,i3 lose "tropical" but gain "temperate".
  #
  # Batch 3: Both parents change in one txn.
  #          cat2 active false->true + reg3 priority 1->2.
  #          i4(cat2,reg3) affected by both changes simultaneously.
  #
  # Batch 4: Item FK change on category_id only.
  #          i3 category cat2->cat1. Switches category subqueries but keeps
  #          region_id=reg1 the same.
  #
  # Batch 5: Item FK change on region_id only.
  #          i2 region reg2->reg3. Switches region subqueries but keeps
  #          category_id=cat1.
  #
  # Batch 6: Item value change (atomic predicate).
  #          i1 value v1->v5. Flips "value >= 'v4'" in shape 3.
  #
  # Batch 7: Item FK change on both columns at once.
  #          i5 cat3,reg2 -> cat1,reg1. Both FK dimensions change.
  #
  # Batch 8: Insert new item.
  #          i7->cat2,reg2 with value=v7.
  #
  # Batch 9: Delete an item.
  #          Remove i4.
  #
  # Batch 10: Category tier change — cat3 basic->premium.
  #           Affects tier-based subqueries. i5(now cat1),i6 change shape
  #           membership through tier filter.
  #
  # Batch 11: Region climate change + item insert in same txn.
  #           reg2 climate temperate->arctic + insert i8->cat3,reg2.
  #           New item enters with post-change region attributes.
  #
  # Batch 12: Restore — undo earlier changes across both parent tables.
  #           cat1 active->true, reg1 climate->tropical, reg3 priority->1.
  #           Multiple parents across different tables in one txn.
  #
  @batches [
    # Batch 1: category active toggle
    [
      [%{name: "cat1_deactivate", sql: "UPDATE category SET active = false WHERE id = 'cat1'"}]
    ],
    # Batch 2: region climate change
    [
      [
        %{
          name: "reg1_to_temperate",
          sql: "UPDATE region SET climate = 'temperate' WHERE id = 'reg1'"
        }
      ]
    ],
    # Batch 3: both parent tables change in one txn
    [
      [
        %{name: "cat2_activate", sql: "UPDATE category SET active = true WHERE id = 'cat2'"},
        %{name: "reg3_priority_up", sql: "UPDATE region SET priority = 2 WHERE id = 'reg3'"}
      ]
    ],
    # Batch 4: item category FK change only
    [
      [
        %{
          name: "i3_change_category",
          sql: "UPDATE item SET category_id = 'cat1' WHERE id = 'i3'"
        }
      ]
    ],
    # Batch 5: item region FK change only
    [
      [
        %{
          name: "i2_change_region",
          sql: "UPDATE item SET region_id = 'reg3' WHERE id = 'i2'"
        }
      ]
    ],
    # Batch 6: item value change (atomic predicate)
    [
      [%{name: "i1_value_change", sql: "UPDATE item SET value = 'v5' WHERE id = 'i1'"}]
    ],
    # Batch 7: item both FKs change at once
    [
      [
        %{
          name: "i5_change_both_fks",
          sql: "UPDATE item SET category_id = 'cat1', region_id = 'reg1' WHERE id = 'i5'"
        }
      ]
    ],
    # Batch 8: insert new item
    [
      [
        %{
          name: "insert_i7",
          sql: "INSERT INTO item (id, category_id, region_id, value) VALUES ('i7', 'cat2', 'reg2', 'v7')"
        }
      ]
    ],
    # Batch 9: delete item
    [
      [%{name: "delete_i4", sql: "DELETE FROM item WHERE id = 'i4'"}]
    ],
    # Batch 10: category tier change
    [
      [
        %{
          name: "cat3_tier_to_premium",
          sql: "UPDATE category SET tier = 'premium' WHERE id = 'cat3'"
        }
      ]
    ],
    # Batch 11: region change + item insert in same txn
    [
      [
        %{
          name: "reg2_to_arctic",
          sql: "UPDATE region SET climate = 'arctic' WHERE id = 'reg2'"
        },
        %{
          name: "insert_i8",
          sql: "INSERT INTO item (id, category_id, region_id, value) VALUES ('i8', 'cat3', 'reg2', 'v2')"
        }
      ]
    ],
    # Batch 12: restore multiple parents across both tables
    [
      [
        %{name: "cat1_reactivate", sql: "UPDATE category SET active = true WHERE id = 'cat1'"},
        %{
          name: "reg1_to_tropical",
          sql: "UPDATE region SET climate = 'tropical' WHERE id = 'reg1'"
        },
        %{name: "reg3_priority_down", sql: "UPDATE region SET priority = 1 WHERE id = 'reg3'"}
      ]
    ]
  ]

  @tag with_sql: @base_sql
  test "OR-branches AND composition with targeted mutations", ctx do
    test_against_oracle(ctx, @shapes, @batches)
  end
end
