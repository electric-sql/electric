Please take a look at the lib/electric/replication/eval/decomposer.ex and test/electric/replication/eval/decomposer_test.exs files. I want you to implement the function in the Decomposer module accoring to docs and tests. You can validate your work with `mix test test/electric/replication/eval/decomposer_test.exs`. If stuck, please add `dbg()` statements, run one test a time and figure out the issue until it all works. You're allowed to change the order of elements in lists in `expected_disjuncts` assertions, but not alter the elements OR change the total list contents - tests are expected to be correct for everything but the order. Once all the tests pass, you MUST output <promise>TESTS COMPLETE</promise>

You have an example of a parsed AST that will be passed to the function in test/electric/replication/eval/.example.exs if you need it.

We have existing tools to help with this task: since we're walking an AST, we have a walker/folder/reducer already implmented for these AST nodes, available in lib/electric/replication/eval/walker.ex

If you need to run any Elixir code larger than one line, write it to a `./tmp/{file}.exs` and execute with `mix run --no-start tmp/{file}.exs`
