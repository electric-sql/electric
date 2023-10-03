# Used by "mix format"
[
  inputs: ["{mix,.formatter}.exs", "{config,lib,test}/**/*.{ex,exs}"],
  locals_without_parens: [test_tx: 2, defpostgres: 2],
  import_deps: [:plug, :stream_data]
]
