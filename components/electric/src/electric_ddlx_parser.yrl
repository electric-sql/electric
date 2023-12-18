Nonterminals 
   stmt
   enable_stmt
   assign_stmt
   grant_stmt
   revoke_stmt
   disable_stmt
   unassign_stmt
   sqlite_stmt
   table_ident
   identifier
   scoped_role
   grant_scoped_role
   scope
   role
   column_ident
   if_expr
   expr
   op
   const
   func_args
   permissions
   privilege
   privileges
   using_clause
   scope_path
   column_list
   columns
   check_clause
   .

% terminals are the outputs of the tokeniser, so e.g. the terminal
% `ELECTRIC` is output from the tokeniser as `{:ELECTRIC, {line, char, nil}, "ELECTRIC"}`
% the first element of the tuple is the terminal and the last element is the original
% expression in the source, used for error msgs
Terminals 
   '.' '(' ')' ',' ':'
   'ALTER' 'TABLE' 'DISABLE' 'ENABLE' 'ELECTRIC' 'NULL' 'UNASSIGN' 'ASSIGN' 'TO' 'IF'
   'GRANT' 'ON' 'USING' 'SELECT' 'INSERT' 'UPDATE' 'DELETE' 'ALL' 'READ' 'WRITE' 'CHECK'
   'REVOKE' 'FROM' 'SQLITE'
   'AUTHENTICATED' 'ANYONE' 'PRIVILEGES'
   string  int float
   unquoted_identifier quoted_identifier
   '=' '>' '<' '<=' '>=' '!=' '<>' '+' '/' '*' '-'
   'AND' 'IS' 'NOT' 'OR'
   .


Rootsymbol stmt.

Left      20 ','.
Right    100 '=' '!=' '<>'.
Left     150 '<' '>' '<=' '>='.
Left     120 'OR'.
Left     130 'AND'.
Left     170 'IS' 'NOT'.
Left     210 '+' '-'.
Left     220 '*' '/'.

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

stmt -> enable_stmt : '$1'.
stmt -> assign_stmt : '$1'.
stmt -> grant_stmt : '$1'.
stmt -> revoke_stmt : '$1'.
stmt -> disable_stmt : '$1'.
stmt -> unassign_stmt : '$1'.
stmt -> sqlite_stmt : '$1'.

% ALTER TABLE ENABLE ELECTRIC
enable_stmt -> 'ALTER' 'TABLE' table_ident 'ENABLE' 'ELECTRIC' : enable_cmd('$3').
enable_stmt -> 'ELECTRIC' 'ENABLE' table_ident : enable_cmd('$3').

% ALTER TABLE DISABLE ELECTRIC
disable_stmt -> 'ALTER' 'TABLE' table_ident 'DISABLE' 'ELECTRIC' : disable_cmd('$3').
disable_stmt -> 'ELECTRIC' 'DISABLE' table_ident : disable_cmd('$3').

% ELECTRIC ASSIGN
assign_stmt -> 'ELECTRIC' 'ASSIGN' scoped_role 'TO' column_ident : assign_cmd('$3' ++ '$5').
assign_stmt -> 'ELECTRIC' 'ASSIGN' scoped_role 'TO' column_ident 'IF' if_expr : assign_cmd('$3' ++ '$5' ++ '$7').

% ELECTRIC UNASSIGN
unassign_stmt -> 'ELECTRIC' 'UNASSIGN' scoped_role 'FROM' column_ident : unassign_cmd('$3' ++ '$5').

% ELECTRIC GRANT
grant_stmt -> 'ELECTRIC' 'GRANT' permissions 'ON' table_ident 'TO' grant_scoped_role using_clause check_clause : grant_cmd('$3' ++ '$5' ++ '$7' ++ '$8' ++ '$9').

% ELECTRIC REVOKE
revoke_stmt -> 'ELECTRIC' 'REVOKE' permissions 'ON' table_ident 'FROM' grant_scoped_role : revoke_cmd('$3' ++ '$5' ++ '$7').

% ELECTRIC SQLITE
sqlite_stmt -> 'ELECTRIC' 'SQLITE' string : sqlite_cmd(unwrap('$3')).

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

table_ident -> identifier : [{table_name, '$1'}].
table_ident -> identifier '.' identifier : [{table_schema, '$1'}, {table_name, '$3'}].

identifier -> unquoted_identifier : unquoted_identifier('$1').
identifier -> quoted_identifier : unwrap('$1').

grant_scoped_role -> 'AUTHENTICATED' : [{role_name, 'AUTHENTICATED'}].
grant_scoped_role -> 'ANYONE' : [{role_name, 'ANYONE'}].
grant_scoped_role -> scoped_role : '$1'.

scoped_role -> '(' scope ',' role ')' : '$2' ++ '$4'.
scoped_role -> scope ':' role : '$1' ++ '$3'.
scoped_role -> role : [{scope, nil}] ++ '$1'.

role -> string : [{role_name, unwrap('$1')}].
role -> identifier '.' identifier : [{role_table_name, '$1'}, {role_table_column, '$3'}].
role -> identifier '.' identifier '.' identifier : [{role_table_schema, '$1'}, {role_table_name, '$3'}, {role_table_column, '$5'}].
role -> identifier : [{role_table_column, '$1'}].

scope -> 'NULL' : [{scope, nil}].
scope -> identifier : [{scope_table_name, '$1'}].
scope -> identifier '.' identifier : [{scope_schema_name, '$1'}, {scope_table_name, '$3'}].

column_ident -> identifier '.' identifier : [{user_table_name, '$1'}, {user_table_column, '$3'}].
column_ident -> identifier '.' identifier '.' identifier : [{user_table_schema, '$1'}, {user_table_name, '$3'}, {user_table_column, '$5'}].


%% don't want to get into parsing expressions, so just reproduce the expression
%% as a binary for parsing somewhere else

if_expr -> '(' expr ')' : [{'if', erlang:iolist_to_binary('$2')}].

expr -> '(' expr ')' : ["(", '$2', ")"].
expr -> expr op expr : ['$1', " ", '$2', " ", '$3']. %[{expr, [{op, '$2'}, {left, '$1'}, {right, '$3'}]}].
expr -> identifier '(' func_args ')' : ['$1', "(", '$3', ")"]. % [{func_call, '$1', '$3'}].
expr -> identifier : ['$1']. % [{name, '$1'}].
expr -> const : ['$1']. % [{const, '$1'}].

op -> '=' : ["="].
op -> '>' : [">"].
op -> '<' : ["<"].
op -> '<=' : ["<="].
op -> '>=' : [">="].
op -> '<>' : ["<>"].
op -> '!=' : ["!="].
op -> '*' : ["*"].
op -> '+' : ["+"].
op -> '/' : ["/"].
op -> '-' : ["-"].
op -> 'AND' : ["AND"].
op -> 'OR' : ["OR"].
op -> 'NOT' : ["NOT"].
op -> 'IS' : ["IS"].

const -> string : ["'", unwrap('$1'), "'"]. 
const -> int : erlang:integer_to_list(unwrap('$1')). 
const -> float : erlang:float_to_list(unwrap('$1')). 

func_args -> '$empty' : [].
func_args -> expr : ['$1'].
func_args -> expr ',' func_args : ['$1', "," , '$3'].

permissions -> privileges column_list : [{privilege, '$1'}] ++ '$2'.

privileges -> '$empty' : [].
privileges -> 'ALL' :  [<<"select">>, <<"insert">>, <<"update">>, <<"delete">>].
privileges -> 'ALL' 'PRIVILEGES' :  [<<"select">>, <<"insert">>, <<"update">>, <<"delete">>].
privileges -> privilege : '$1'.
privileges -> privilege ',' privileges : lists:uniq('$1' ++ '$3').

privilege -> 'SELECT' : [<<"select">>].
privilege -> 'INSERT' : [<<"insert">>].
privilege -> 'UPDATE' : [<<"update">>].
privilege -> 'DELETE' : [<<"delete">>].
privilege -> 'READ' :  [<<"select">>].
privilege -> 'WRITE' :  [<<"insert">>, <<"update">>, <<"delete">>].

column_list -> '$empty' : [].
column_list -> '(' columns ')' : [{column_names, '$2'}] .

% columns -> '$empty' : [].
columns -> identifier : ['$1'].
columns -> identifier ',' columns : ['$1' | '$3'].

using_clause -> '$empty' : [].
using_clause -> 'USING' scope_path : [{using, '$2'}].

scope_path -> '$empty' : [].
scope_path -> identifier : ['$1'].
scope_path -> identifier '/' scope_path : ['$1' | '$3'].

check_clause -> '$empty' : [].
check_clause -> 'CHECK' '(' expr ')' : [{check, erlang:iolist_to_binary('$3')}].

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
Erlang code.
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%


unwrap({_, _, V}) -> V.

enable_cmd(TableName) ->
  {'Elixir.Electric.DDLX.Command.Enable', TableName}.

disable_cmd(TableName) ->
  {'Elixir.Electric.DDLX.Command.Disable', TableName}.

assign_cmd(Attrs) ->
  {'Elixir.Electric.DDLX.Command.Assign', Attrs}.

unassign_cmd(Attrs) ->
  {'Elixir.Electric.DDLX.Command.Unassign', Attrs}.

grant_cmd(Attrs) ->
  {'Elixir.Electric.DDLX.Command.Grant', Attrs}.

revoke_cmd(Attrs) ->
  {'Elixir.Electric.DDLX.Command.Revoke', Attrs}.

sqlite_cmd(Stmt) ->
  {'Elixir.Electric.DDLX.Command.SQLite', [{statement, Stmt}]}.

% this is the last place in the stack that knows whether an identifier is quoted
% or unquoted, so this is where we match pg's behaviour and downcase unquoted
% identifiers.
unquoted_identifier({_, _, Ident}) ->
  'Elixir.String':downcase(Ident).
