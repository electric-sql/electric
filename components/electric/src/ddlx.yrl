Nonterminals 
   stmt
   enable_stmt
   assign_stmt
   table_ident
   name
   quoted_ident
   unquoted_ident
   scoped_role
   scope
   role
   column_ident
   namespaced_name
   .

Terminals 
   '"' '\'' '.' '(' ')' ',' ':'
   alter table enable electric null assign to
   string  ident int
   .


Rootsymbol stmt.

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

stmt -> enable_stmt : '$1'.
stmt -> assign_stmt : '$1'.

enable_stmt -> alter table table_ident enable electric : enable_cmd('$3').

assign_stmt -> electric assign scoped_role to column_ident : assign_cmd('$3', '$5').

table_ident -> name : '$1'.
table_ident -> namespaced_name : '$1'.

name -> quoted_ident : '$1'.
name -> unquoted_ident : '$1'.

quoted_ident -> '"' ident '"' : unwrap_ident('$2').
unquoted_ident -> ident : downcase('$1').

scoped_role -> role : [{scope, nil}] ++ '$1'.
scoped_role -> scope ':' role : [{scope, '$1'}] ++ '$3'.
scoped_role -> '(' scope ',' role ')' : '$2' ++ '$4'.

role -> '\'' string '\'' : [{role_name, unwrap('$2')}].
role -> name '.' name : [{role_table_name, '$1'}, {role_table_column, '$3'}].
role -> name '.' name '.' name : [{role_table_schema, '$1'}, {role_table_name, '$3'}, {role_table_column, '$5'}].
role -> name : [{role_table_column, '$1'}].

scope -> null : [{scope, nil}].
scope -> name : [{scope_table_name, '$1'}].
scope -> name '.' name : [{scope_schema_name, '$1'}, {scope_table_name, '$3'}].

column_ident -> name '.' name : [{user_table_name, '$1'}, {user_table_column, '$3'}].
column_ident -> name '.' name '.' name : [{user_table_schema, '$1'}, {user_table_name, '$3'}, {user_table_column, '$5'}].

namespaced_name -> name '.' name : {'$1', '$3'}.

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
Erlang code.
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%


unwrap_ident({ident, _, V}) -> V.

unwrap({_, _, V}) -> V.

enable_cmd(TableName) ->
  {'Elixir.Electric.DDLX.Command.Enable', [ {table_name, TableName} ]}.

assign_cmd(Role, Column) ->
  {'Elixir.Electric.DDLX.Command.Assign', Role ++ Column}.

downcase(String) -> 'Elixir.String':downcase(unwrap(String)).
