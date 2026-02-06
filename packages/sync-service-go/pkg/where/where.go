// Package where provides parsing and validation of SQL WHERE clauses.
// It uses pg_query_go to parse PostgreSQL-compatible WHERE clauses and
// validates that only allowed constructs are used.
package where

import (
	"fmt"
	"sort"
	"strings"

	pg_query "github.com/pganalyze/pg_query_go/v5"
)

// WhereClause represents a parsed and validated WHERE clause.
type WhereClause struct {
	// original is the original WHERE clause string
	original string
	// normalizedSQL is the SQL normalized from the AST
	normalizedSQL string
	// columns contains the referenced column names
	columns []string
	// ast is the parsed AST node
	ast *pg_query.Node
}

// Parse parses a WHERE clause string and validates that only allowed
// constructs are used. Returns the parsed WhereClause or an error.
//
// Allowed constructs:
//   - Comparison operators: =, <>, !=, <, >, <=, >=
//   - Logical operators: AND, OR, NOT
//   - IS NULL, IS NOT NULL
//   - IN (list), NOT IN (list)
//   - BETWEEN, LIKE, ILIKE
//   - Literals: strings, numbers, booleans, NULL
//   - Column references (unqualified)
//
// Rejected constructs:
//   - Subqueries
//   - Function calls
//   - CASE expressions
//   - Window functions
//   - Aggregates
func Parse(whereClause string) (*WhereClause, error) {
	if strings.TrimSpace(whereClause) == "" {
		return nil, fmt.Errorf("empty WHERE clause")
	}

	// Wrap in SELECT to make it a valid SQL statement
	query := fmt.Sprintf("SELECT 1 WHERE %s", whereClause)

	result, err := pg_query.Parse(query)
	if err != nil {
		return nil, fmt.Errorf("parse error: %w", err)
	}

	if len(result.Stmts) != 1 {
		return nil, fmt.Errorf("unexpected ';' causing statement split")
	}

	stmt := result.Stmts[0].Stmt
	if stmt.GetSelectStmt() == nil {
		return nil, fmt.Errorf("unexpected statement type")
	}

	selectStmt := stmt.GetSelectStmt()

	// Validate no extra clauses
	if err := validateNoExtraClauses(selectStmt); err != nil {
		return nil, err
	}

	whereNode := selectStmt.WhereClause
	if whereNode == nil {
		return nil, fmt.Errorf("missing WHERE clause")
	}

	// Validate the AST and collect column references
	validator := &astValidator{columns: make(map[string]struct{})}
	if err := validator.validate(whereNode); err != nil {
		return nil, err
	}

	// Extract and sort column names
	columns := make([]string, 0, len(validator.columns))
	for col := range validator.columns {
		columns = append(columns, col)
	}
	sort.Strings(columns)

	// Generate normalized SQL
	normalizedSQL, err := nodeToSQL(whereNode)
	if err != nil {
		return nil, fmt.Errorf("failed to normalize SQL: %w", err)
	}

	return &WhereClause{
		original:      whereClause,
		normalizedSQL: normalizedSQL,
		columns:       columns,
		ast:           whereNode,
	}, nil
}

// validateNoExtraClauses checks that the SELECT statement has no extra clauses
func validateNoExtraClauses(stmt *pg_query.SelectStmt) error {
	if len(stmt.DistinctClause) > 0 {
		return fmt.Errorf("DISTINCT clause not allowed")
	}
	if len(stmt.GroupClause) > 0 {
		return fmt.Errorf("GROUP BY clause not allowed")
	}
	if stmt.HavingClause != nil {
		return fmt.Errorf("HAVING clause not allowed")
	}
	if len(stmt.WindowClause) > 0 {
		return fmt.Errorf("WINDOW clause not allowed")
	}
	if len(stmt.SortClause) > 0 {
		return fmt.Errorf("ORDER BY clause not allowed")
	}
	if stmt.LimitCount != nil || stmt.LimitOffset != nil {
		return fmt.Errorf("LIMIT/OFFSET clause not allowed")
	}
	if len(stmt.LockingClause) > 0 {
		return fmt.Errorf("FOR UPDATE/SHARE clause not allowed")
	}
	if stmt.WithClause != nil {
		return fmt.Errorf("WITH clause not allowed")
	}
	return nil
}

// ReferencedColumns returns the list of column names referenced in the WHERE clause.
// The list is sorted alphabetically.
func (w *WhereClause) ReferencedColumns() []string {
	result := make([]string, len(w.columns))
	copy(result, w.columns)
	return result
}

// ToSQL returns the normalized SQL representation of the WHERE clause.
func (w *WhereClause) ToSQL() string {
	return w.normalizedSQL
}

// Validate checks that all referenced columns exist in the available columns list.
func (w *WhereClause) Validate(availableColumns []string) error {
	available := make(map[string]struct{}, len(availableColumns))
	for _, col := range availableColumns {
		available[col] = struct{}{}
	}

	var missing []string
	for _, col := range w.columns {
		if _, ok := available[col]; !ok {
			missing = append(missing, col)
		}
	}

	if len(missing) > 0 {
		sort.Strings(missing)
		return fmt.Errorf("unknown column(s): %s", strings.Join(missing, ", "))
	}

	return nil
}

// Original returns the original WHERE clause string.
func (w *WhereClause) Original() string {
	return w.original
}

// astValidator walks the AST and validates allowed constructs
type astValidator struct {
	columns map[string]struct{}
}

func (v *astValidator) validate(node *pg_query.Node) error {
	if node == nil {
		return nil
	}

	switch n := node.Node.(type) {
	case *pg_query.Node_AExpr:
		return v.validateAExpr(n.AExpr)

	case *pg_query.Node_BoolExpr:
		return v.validateBoolExpr(n.BoolExpr)

	case *pg_query.Node_NullTest:
		return v.validateNullTest(n.NullTest)

	case *pg_query.Node_ColumnRef:
		return v.validateColumnRef(n.ColumnRef)

	case *pg_query.Node_AConst:
		return v.validateAConst(n.AConst)

	case *pg_query.Node_TypeCast:
		return v.validateTypeCast(n.TypeCast)

	case *pg_query.Node_List:
		for _, item := range n.List.Items {
			if err := v.validate(item); err != nil {
				return err
			}
		}
		return nil

	case *pg_query.Node_SubLink:
		return fmt.Errorf("subqueries are not allowed")

	case *pg_query.Node_FuncCall:
		return fmt.Errorf("function calls are not allowed")

	case *pg_query.Node_CaseExpr:
		return fmt.Errorf("CASE expressions are not allowed")

	case *pg_query.Node_WindowFunc:
		return fmt.Errorf("window functions are not allowed")

	case *pg_query.Node_BooleanTest:
		return v.validateBooleanTest(n.BooleanTest)

	case *pg_query.Node_ParamRef:
		// Parameter references like $1 are allowed
		return nil

	default:
		return fmt.Errorf("unsupported expression type: %T", node.Node)
	}
}

func (v *astValidator) validateAExpr(expr *pg_query.A_Expr) error {
	if expr == nil {
		return nil
	}

	// Validate the operator kind
	switch expr.Kind {
	case pg_query.A_Expr_Kind_AEXPR_OP:
		// Regular operator (=, <>, <, >, <=, >=, etc.)
		if err := v.validateOperator(expr.Name); err != nil {
			return err
		}
	case pg_query.A_Expr_Kind_AEXPR_OP_ANY:
		// expr op ANY (array)
		return fmt.Errorf("ANY operator is not allowed")
	case pg_query.A_Expr_Kind_AEXPR_OP_ALL:
		// expr op ALL (array)
		return fmt.Errorf("ALL operator is not allowed")
	case pg_query.A_Expr_Kind_AEXPR_DISTINCT:
		// IS DISTINCT FROM
		return fmt.Errorf("IS DISTINCT FROM is not allowed")
	case pg_query.A_Expr_Kind_AEXPR_NOT_DISTINCT:
		// IS NOT DISTINCT FROM
		return fmt.Errorf("IS NOT DISTINCT FROM is not allowed")
	case pg_query.A_Expr_Kind_AEXPR_NULLIF:
		return fmt.Errorf("NULLIF is not allowed")
	case pg_query.A_Expr_Kind_AEXPR_IN:
		// IN (list) - allowed
	case pg_query.A_Expr_Kind_AEXPR_LIKE:
		// LIKE - allowed
	case pg_query.A_Expr_Kind_AEXPR_ILIKE:
		// ILIKE - allowed
	case pg_query.A_Expr_Kind_AEXPR_SIMILAR:
		return fmt.Errorf("SIMILAR TO is not allowed")
	case pg_query.A_Expr_Kind_AEXPR_BETWEEN,
		pg_query.A_Expr_Kind_AEXPR_NOT_BETWEEN,
		pg_query.A_Expr_Kind_AEXPR_BETWEEN_SYM,
		pg_query.A_Expr_Kind_AEXPR_NOT_BETWEEN_SYM:
		// BETWEEN variants - allowed
	default:
		return fmt.Errorf("unsupported expression kind: %v", expr.Kind)
	}

	// Validate left and right expressions
	if err := v.validate(expr.Lexpr); err != nil {
		return err
	}
	if err := v.validate(expr.Rexpr); err != nil {
		return err
	}

	return nil
}

func (v *astValidator) validateOperator(names []*pg_query.Node) error {
	if len(names) == 0 {
		return nil
	}

	// Get operator name
	var opName string
	for _, name := range names {
		if s := name.GetString_(); s != nil {
			opName = s.Sval
			break
		}
	}

	// Check allowed operators
	allowedOps := map[string]bool{
		"=":    true,
		"<>":   true,
		"!=":   true,
		"<":    true,
		">":    true,
		"<=":   true,
		">=":   true,
		"~~":   true, // LIKE
		"!~~":  true, // NOT LIKE
		"~~*":  true, // ILIKE
		"!~~*": true, // NOT ILIKE
	}

	if !allowedOps[opName] && opName != "" {
		return fmt.Errorf("operator '%s' is not allowed", opName)
	}

	return nil
}

func (v *astValidator) validateBoolExpr(expr *pg_query.BoolExpr) error {
	if expr == nil {
		return nil
	}

	// AND, OR, NOT are all allowed
	switch expr.Boolop {
	case pg_query.BoolExprType_AND_EXPR,
		pg_query.BoolExprType_OR_EXPR,
		pg_query.BoolExprType_NOT_EXPR:
		// Allowed
	default:
		return fmt.Errorf("unsupported boolean operator: %v", expr.Boolop)
	}

	for _, arg := range expr.Args {
		if err := v.validate(arg); err != nil {
			return err
		}
	}

	return nil
}

func (v *astValidator) validateNullTest(expr *pg_query.NullTest) error {
	if expr == nil {
		return nil
	}

	// IS NULL and IS NOT NULL are allowed
	return v.validate(expr.Arg)
}

func (v *astValidator) validateBooleanTest(expr *pg_query.BooleanTest) error {
	if expr == nil {
		return nil
	}

	// IS TRUE, IS FALSE, IS NOT TRUE, IS NOT FALSE, IS UNKNOWN, IS NOT UNKNOWN
	return v.validate(expr.Arg)
}

func (v *astValidator) validateColumnRef(ref *pg_query.ColumnRef) error {
	if ref == nil {
		return nil
	}

	// Check that it's an unqualified column reference
	if len(ref.Fields) == 0 {
		return fmt.Errorf("empty column reference")
	}

	if len(ref.Fields) > 1 {
		return fmt.Errorf("qualified column references are not allowed (table.column format)")
	}

	// Extract column name
	field := ref.Fields[0]
	if str := field.GetString_(); str != nil {
		v.columns[str.Sval] = struct{}{}
	} else {
		return fmt.Errorf("invalid column reference")
	}

	return nil
}

func (v *astValidator) validateAConst(c *pg_query.A_Const) error {
	if c == nil {
		return nil
	}

	// All literal types are allowed: strings, numbers, booleans, NULL
	return nil
}

func (v *astValidator) validateTypeCast(tc *pg_query.TypeCast) error {
	if tc == nil {
		return nil
	}

	// Validate the argument being cast
	return v.validate(tc.Arg)
}

// nodeToSQL converts an AST node back to SQL
func nodeToSQL(node *pg_query.Node) (string, error) {
	if node == nil {
		return "", nil
	}

	// Build a SELECT statement with the WHERE clause and deparse it
	selectStmt := &pg_query.SelectStmt{
		TargetList: []*pg_query.Node{
			{
				Node: &pg_query.Node_ResTarget{
					ResTarget: &pg_query.ResTarget{
						Val: &pg_query.Node{
							Node: &pg_query.Node_AConst{
								AConst: &pg_query.A_Const{
									Val: &pg_query.A_Const_Ival{
										Ival: &pg_query.Integer{Ival: 1},
									},
								},
							},
						},
					},
				},
			},
		},
		WhereClause: node,
	}

	parseResult := &pg_query.ParseResult{
		Version: 160001,
		Stmts: []*pg_query.RawStmt{
			{
				Stmt: &pg_query.Node{
					Node: &pg_query.Node_SelectStmt{
						SelectStmt: selectStmt,
					},
				},
			},
		},
	}

	sql, err := pg_query.Deparse(parseResult)
	if err != nil {
		return "", err
	}

	// Extract just the WHERE clause portion
	const prefix = "SELECT 1 WHERE "
	if strings.HasPrefix(sql, prefix) {
		return sql[len(prefix):], nil
	}

	return sql, nil
}
