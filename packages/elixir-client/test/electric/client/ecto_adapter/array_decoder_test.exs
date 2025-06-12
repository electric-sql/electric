defmodule Electric.Client.EctoAdapter.ArrayDecoderTest do
  use ExUnit.Case, async: true
  alias Electric.Client.EctoAdapter.ArrayDecoder

  test "simple string arrays" do
    assert ArrayDecoder.decode!(~s[{}], :string) == []
    assert ArrayDecoder.decode!(~s[{a,b,c}], :string) == ["a", "b", "c"]
    assert ArrayDecoder.decode!(~s[{"a","b","c"}], :string) == ["a", "b", "c"]
    assert ArrayDecoder.decode!(~s[{"a{}","b","c"}], :string) == ["a{}", "b", "c"]
    assert ArrayDecoder.decode!(~S[{"a\"","b","c"}], :string) == ["a\"", "b", "c"]

    assert ArrayDecoder.decode!(~S[{"this isn't here","b","c"}], :string) == [
             "this isn't here",
             "b",
             "c"
           ]

    assert ArrayDecoder.decode!(~S[{NULL,NULL,"NULL"}], :string) == [nil, nil, "NULL"]
  end

  test "nested string arrays" do
    assert ArrayDecoder.decode!(~s[{{},{}}], :string) == [[], []]

    assert ArrayDecoder.decode!(~s[{{"a","b","c"},{},{c,d,e}], :string) == [
             ["a", "b", "c"],
             [],
             ["c", "d", "e"]
           ]
  end

  test "simple integer arrays" do
    assert ArrayDecoder.decode!(~s[{}], :integer) == []
    assert ArrayDecoder.decode!(~s[{1,2,3}], :integer) == [1, 2, 3]
    assert ArrayDecoder.decode!(~S[{NULL,NULL,23}], :integer) == [nil, nil, 23]
  end

  test "nested integer arrays" do
    assert ArrayDecoder.decode!(~s[{{},{}}], :integer) == [[], []]

    assert ArrayDecoder.decode!(~s[{{1,2,3},{},{4,5,6}], :integer) == [
             [1, 2, 3],
             [],
             [4, 5, 6]
           ]

    assert ArrayDecoder.decode!(~s[{{{1,{2,{7,8}},3},{},{4,5,6}}], :integer) == [
             [
               [1, [2, [7, 8]], 3],
               [],
               [4, 5, 6]
             ]
           ]
  end

  test "nested jsonb arrays" do
    assert ArrayDecoder.decode!(~s[{{{"{\\\"this\\\":4}"},"{}"},{},{"{}","{}"}], :map) == [
             [[%{"this" => 4}], %{}],
             [],
             [%{}, %{}]
           ]
  end
end
