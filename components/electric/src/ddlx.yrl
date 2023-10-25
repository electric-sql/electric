Nonterminals 
   stmt
   enable_stmt
   assign_stmt
   grant_stmt
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
   grant_perms
   grant_privs
   using_clause
   scope_path
   column_list
   columns
   check_clause
   .

% terminals are the outputs of the tokeniser, so e.g. the terminal
% `electric` is output from the tokeniser as `{:electric, {line, char, nil}, "ELECTRIC"}`
% the first element of the tuple is the terminal and the last element is the original
% expression in the source, used for error msgs
Terminals 
   '"' '\'' '.' '(' ')' ',' ':' '/'
   alter table enable electric null assign to if
   grant on using select insert update delete all read write check
   string  ident int float
   '=' '>' '<' '<=' '>='
   .


Rootsymbol stmt.

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

stmt -> enable_stmt : '$1'.
stmt -> assign_stmt : '$1'.
stmt -> grant_stmt : '$1'.

enable_stmt -> alter table table_ident enable electric : enable_cmd('$3').

assign_stmt -> electric assign scoped_role to column_ident : assign_cmd('$3' ++ '$5').
assign_stmt -> electric assign scoped_role to column_ident if if_expr : assign_cmd('$3' ++ '$5' ++ '$7').

grant_stmt -> electric grant grant_perms on table_ident to scoped_role using_clause check_clause : grant_cmd('$3' ++ '$5' ++ '$7' ++ '$8' ++ '$9').

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

const -> '\'' string '\'' : ["'", unwrap('$2'), "'"]. 
const -> int : erlang:integer_to_list(unwrap('$1')). 
const -> float : erlang:float_to_list(unwrap('$1')). 

func_args -> '$empty' : [].
func_args -> expr : ['$1'].
func_args -> expr ',' func_args : ['$1', "," , '$3'].

grant_perms -> grant_privs column_list : [{privilege, '$1'}] ++ '$2'.

grant_privs -> select : ["select"].
grant_privs -> insert : ["insert"].
grant_privs -> update : ["update"].
grant_privs -> delete : ["delete"].
grant_privs -> all :  ["select", "insert", "update", "delete"].
grant_privs -> read :  ["select"].
grant_privs -> write :  ["insert", "update", "delete"].

column_list -> '$empty' : [].
column_list -> '(' columns ')' : [{column_names, '$2'}] .

% columns -> '$empty' : [].
columns -> name : ['$1'].
columns -> name ',' columns : ['$1' | '$3'].

using_clause -> '$empty' : [].
using_clause -> using scope_path : [{using, '$2'}].

scope_path -> '$empty' : [].
scope_path -> name : ['$1'].
scope_path -> name '/' scope_path : ['$1' | '$3'].

check_clause -> '$empty' : [].
check_clause -> check '(' expr ')' : [{check, erlang:iolist_to_binary('$3')}].

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
Erlang code.
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%


unwrap_ident({ident, _, V}) -> V.

unwrap({_, _, V}) -> V.

enable_cmd(TableName) ->
  {'Elixir.Electric.DDLX.Command.Enable', TableName}.

assign_cmd(Attrs) ->
  {'Elixir.Electric.DDLX.Command.Assign', Attrs}.

grant_cmd(Attrs) ->
  {'Elixir.Electric.DDLX.Command.Grant', Attrs}.

downcase(String) -> 'Elixir.String':downcase(unwrap(String)).
