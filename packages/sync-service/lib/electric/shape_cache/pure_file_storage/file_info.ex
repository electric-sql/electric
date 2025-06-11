defmodule Electric.ShapeCache.PureFileStorage.FileInfo do
  require Record
  Record.defrecord(:file_info, Record.extract(:file_info, from_lib: "kernel/include/file.hrl"))
end
