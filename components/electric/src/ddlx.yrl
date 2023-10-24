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
   if_expr
   expr
   op
   const
   func_args

   .

Terminals 
   '"' '\'' '.' '(' ')' ',' ':'
   alter table enable electric null assign to if
   string  ident int float
   '=' '>' '<' '<=' '>='
   .


Rootsymbol stmt.

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

stmt -> enable_stmt : '$1'.
stmt -> assign_stmt : '$1'.

enable_stmt -> alter table table_ident enable electric : enable_cmd('$3').

assign_stmt -> electric assign scoped_role to column_ident : assign_cmd('$3' ++ '$5').
assign_stmt -> electric assign scoped_role to column_ident if if_expr : assign_cmd('$3' ++ '$5' ++ '$7').

table_ident -> name : [{table_name, '$1'}].
table_ident -> name '.' name : [{table_schema, '$1'}, {table_name, '$3'}].

name -> quoted_ident : '$1'.
name -> unquoted_ident : '$1'.

quoted_ident -> '"' ident '"' : unwrap_ident('$2').
unquoted_ident -> ident : downcase('$1').

scoped_role -> role : [{scope, nil}] ++ '$1'.
scoped_role -> scope ':' role : '$1' ++ '$3'.
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

%% don't want to get into parsing expressions, so just reproduce the expression
%% as a binary for parsing somewhere else

if_expr -> '(' expr ')' : [{'if', erlang:iolist_to_binary('$2')}].

expr -> '(' expr ')' : ["(", '$2', ")"].
expr -> expr op expr : ['$1', " ", '$2', " ", '$3']. %[{expr, [{op, '$2'}, {left, '$1'}, {right, '$3'}]}].
expr -> name '(' func_args ')' : ['$1', "(", '$3', ")"]. % [{func_call, '$1', '$3'}].
expr -> name : ['$1']. % [{name, '$1'}].
expr -> const : ['$1']. % [{const, '$1'}].

op -> '=' : ["="].
op -> '>' : [">"].
op -> '<' : ["<"].
op -> '<=' : ["<="].
op -> '>=' : [">="].

const -> '\'' string '\'' : ["'", '$2', "'"]. % {string, unwrap('$2')}.
const -> int : erlang:integer_to_list(unwrap('$1')). % {int, unwrap('$1')}.
const -> float : erlang:float_to_list(unwrap('$1')). % {float, unwrap('$1')}.

func_args -> '$empty' : [].
func_args -> expr : ['$1'].
func_args -> expr ',' func_args : ['$1', "," , '$3'].

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
Erlang code.
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%


unwrap_ident({ident, _, V}) -> V.

unwrap({_, _, V}) -> V.

enable_cmd(TableName) ->
  {'Elixir.Electric.DDLX.Command.Enable', TableName}.

assign_cmd(Attrs) ->
  {'Elixir.Electric.DDLX.Command.Assign', Attrs}.

downcase(String) -> 'Elixir.String':downcase(unwrap(String)).
