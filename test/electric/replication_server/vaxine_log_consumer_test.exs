defmodule Electric.ReplicationServer.VaxineLogConsumerTest do
  use ExUnit.Case, async: true

  alias Electric.ReplicationServer.VaxineLogConsumer
  alias Electric.ReplicationServer.VaxineLogConsumer.TransactionBuilder

  @message {:vx_wal_txn, {:tx_id, 1_657_818_413_769_328, :stub},
            [
              {{"rows:public:entries:f7a20872-67ec-4132-a417-e503446b9dba", "vax"},
               :antidote_crdt_map_rr,
               {:dict, 5, 16, 16, 8, 80, 48,
                {[], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []},
                {{[], [], [], [],
                  [
                    [
                      {"id", :antidote_crdt_register_lww}
                      | {1_657_818_413_774_141,
                         "public:entries:f7a20872-67ec-4132-a417-e503446b9dba"}
                    ]
                  ],
                  [
                    [
                      {"deleted?", :antidote_crdt_flag_dw}
                      | {[],
                         [
                           <<161, 101, 148, 88, 58, 44, 232, 44, 61, 177, 85, 60, 244, 50, 76, 10,
                             205, 7, 91, 172>>
                         ]}
                    ]
                  ],
                  [
                    [
                      {"table", :antidote_crdt_register_lww}
                      | {1_657_818_413_774_431, "entries"}
                    ]
                  ], [], [],
                  [
                    [
                      {"row", :antidote_crdt_map_rr}
                      | {:dict, 3, 16, 16, 8, 80, 48,
                         {[], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []},
                         {{[], [], [], [],
                           [
                             [
                               {"id", :antidote_crdt_register_lww}
                               | {1_657_818_413_774_211,
                                  <<131, 109, 0, 0, 0, 36, 102, 55, 97, 50, 48, 56, 55, 50, 45,
                                    54, 55, 101, 99, 45, 52, 49, 51, 50, 45, 97, 52, 49, 55, 45,
                                    101, 53, 48, 51, 52, 52, 54, 98, 57, 100, 98, 97>>}
                             ]
                           ], [], [], [], [], [], [], [],
                           [
                             [
                               {"content_b", :antidote_crdt_register_lww}
                               | {1_657_818_413_774_208, <<131, 100, 0, 3, 110, 105, 108>>}
                             ]
                           ], [], [],
                           [
                             [
                               {"content", :antidote_crdt_register_lww}
                               | {1_657_818_413_774_204,
                                  <<131, 109, 0, 0, 0, 14, 105, 108, 105, 107, 101, 116, 114, 97,
                                    105, 110, 115, 49, 48, 48>>}
                             ]
                           ]}}}
                    ]
                  ],
                  [
                    [
                      {"schema", :antidote_crdt_register_lww}
                      | {1_657_818_413_774_299, "public"}
                    ]
                  ], [], [], [], [], []}}},
               [
                 {[
                    {{"deleted?", :antidote_crdt_flag_dw},
                     {:ok,
                      {[], [],
                       [
                         <<161, 101, 148, 88, 58, 44, 232, 44, 61, 177, 85, 60, 244, 50, 76, 10,
                           205, 7, 91, 172>>
                       ]}}}
                  ], []},
                 {[
                    {{"id", :antidote_crdt_register_lww},
                     {:ok,
                      {1_657_818_413_774_141,
                       "public:entries:f7a20872-67ec-4132-a417-e503446b9dba"}}}
                  ], []},
                 {[
                    {{"row", :antidote_crdt_map_rr},
                     {:ok,
                      {[
                         {{"content", :antidote_crdt_register_lww},
                          {:ok,
                           {1_657_818_413_774_204,
                            <<131, 109, 0, 0, 0, 14, 105, 108, 105, 107, 101, 116, 114, 97, 105,
                              110, 115, 49, 48, 48>>}}}
                       ], []}}},
                    {{"row", :antidote_crdt_map_rr},
                     {:ok,
                      {[
                         {{"content_b", :antidote_crdt_register_lww},
                          {:ok, {1_657_818_413_774_208, <<131, 100, 0, 3, 110, 105, 108>>}}}
                       ], []}}},
                    {{"row", :antidote_crdt_map_rr},
                     {:ok,
                      {[
                         {{"id", :antidote_crdt_register_lww},
                          {:ok,
                           {1_657_818_413_774_211,
                            <<131, 109, 0, 0, 0, 36, 102, 55, 97, 50, 48, 56, 55, 50, 45, 54, 55,
                              101, 99, 45, 52, 49, 51, 50, 45, 97, 52, 49, 55, 45, 101, 53, 48,
                              51, 52, 52, 54, 98, 57, 100, 98, 97>>}}}
                       ], []}}}
                  ], []},
                 {[
                    {{"schema", :antidote_crdt_register_lww},
                     {:ok, {1_657_818_413_774_299, "public"}}}
                  ], []},
                 {[
                    {{"table", :antidote_crdt_register_lww},
                     {:ok, {1_657_818_413_774_431, "entries"}}}
                  ], []}
               ]},
              {{"metadata:0", "vax"}, :antidote_crdt_map_rr,
               {:dict, 3, 16, 16, 8, 80, 48,
                {[], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []},
                {{[],
                  [
                    [
                      {"commit_timestamp", :antidote_crdt_register_lww}
                      | {1_657_818_413_770_504, "2022-07-14 17:06:53.762649Z"}
                    ]
                  ],
                  [
                    [
                      {"publication", :antidote_crdt_register_lww}
                      | {1_657_818_413_771_048, "all_tables"}
                    ]
                  ], [], [[{"id", :antidote_crdt_register_lww} | {1_657_818_413_770_829, "0"}]],
                  [], [], [], [], [], [], [], [], [], [], []}}},
               [
                 {[
                    {{"commit_timestamp", :antidote_crdt_register_lww},
                     {:ok, {1_657_818_413_770_504, "2022-07-14 17:06:53.762649Z"}}}
                  ], []},
                 {[{{"id", :antidote_crdt_register_lww}, {:ok, {1_657_818_413_770_829, "0"}}}],
                  []},
                 {[
                    {{"publication", :antidote_crdt_register_lww},
                     {:ok, {1_657_818_413_771_048, "all_tables"}}}
                  ], []}
               ]}
            ]}

  test "are processed" do
    ref = Broadway.test_message(VaxineLogConsumer, @message, metadata: %{})
    assert_receive {:ack, ^ref, [_], _}
  end

  test "messages are turned into transactions" do
    metadata = TransactionBuilder.extract_metadata(@message)
    origin_transaction = TransactionBuilder.build_transaction_for_origin(@message, metadata)
    peers_transaction = TransactionBuilder.build_transaction_for_peers(@message, metadata)

    assert %Electric.Replication.Changes.Transaction{
             changes: [
               %Electric.Replication.Changes.UpdatedRecord{
                 record: %{
                   "content" => "iliketrains100",
                   "content_b" => nil,
                   "id" => "f7a20872-67ec-4132-a417-e503446b9dba"
                 },
                 relation: {"public", "entries"}
               }
             ],
             commit_timestamp: commit_timestamp
           } = origin_transaction

    assert %Electric.Replication.Changes.Transaction{
             changes: [
               %Electric.Replication.Changes.NewRecord{
                 record: %{
                   "content" => "iliketrains100",
                   "content_b" => nil,
                   "id" => "f7a20872-67ec-4132-a417-e503446b9dba"
                 },
                 relation: {"public", "entries"}
               }
             ],
             commit_timestamp: ^commit_timestamp
           } = peers_transaction

    assert %Electric.Replication.Metadata{
             commit_timestamp: ^commit_timestamp,
             id: "0",
             publication: "all_tables"
           } = metadata

    assert %DateTime{} = commit_timestamp
  end
end
