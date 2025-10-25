defmodule Support.Fixtures.Shape do
  alias Electric.Shapes.Shape

  @inspector Support.StubInspector.new(
               tables: ["t1"],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0}
               ]
             )

  def new(id) do
    Shape.new!("t1", where: "id = #{id}", inspector: @inspector)
  end
end
