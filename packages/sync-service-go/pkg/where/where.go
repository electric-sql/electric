// Package where provides parsing and validation of SQL WHERE clauses.
// It uses pg_query_go to parse PostgreSQL-compatible WHERE clauses and
// validates that only allowed constructs are used.
package where

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
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

// Evaluate evaluates the WHERE clause against a row.
// Returns true if the row matches the WHERE clause.
func (w *WhereClause) Evaluate(row map[string]any) (bool, error) {
	eval := &evaluator{row: row}
	result, err := eval.evaluate(w.ast)
	if err != nil {
		return false, err
	}
	// NULL is treated as false for the final result
	if result == nil {
		return false, nil
	}
	b, ok := result.(bool)
	if !ok {
		return false, fmt.Errorf("WHERE clause did not evaluate to boolean")
	}
	return b, nil
}

// evaluator walks the AST and evaluates expressions against a row
type evaluator struct {
	row map[string]any
}

// evaluate evaluates a node and returns the result (any type, or nil for NULL)
func (e *evaluator) evaluate(node *pg_query.Node) (any, error) {
	if node == nil {
		return nil, nil
	}

	switch n := node.Node.(type) {
	case *pg_query.Node_AExpr:
		return e.evaluateAExpr(n.AExpr)

	case *pg_query.Node_BoolExpr:
		return e.evaluateBoolExpr(n.BoolExpr)

	case *pg_query.Node_NullTest:
		return e.evaluateNullTest(n.NullTest)

	case *pg_query.Node_ColumnRef:
		return e.evaluateColumnRef(n.ColumnRef)

	case *pg_query.Node_AConst:
		return e.evaluateAConst(n.AConst)

	case *pg_query.Node_TypeCast:
		return e.evaluateTypeCast(n.TypeCast)

	case *pg_query.Node_BooleanTest:
		return e.evaluateBooleanTest(n.BooleanTest)

	case *pg_query.Node_List:
		// Return a slice of evaluated items
		var items []any
		for _, item := range n.List.Items {
			val, err := e.evaluate(item)
			if err != nil {
				return nil, err
			}
			items = append(items, val)
		}
		return items, nil

	default:
		return nil, fmt.Errorf("unsupported expression type for evaluation: %T", node.Node)
	}
}

func (e *evaluator) evaluateAExpr(expr *pg_query.A_Expr) (any, error) {
	if expr == nil {
		return nil, nil
	}

	switch expr.Kind {
	case pg_query.A_Expr_Kind_AEXPR_OP:
		return e.evaluateOperator(expr)

	case pg_query.A_Expr_Kind_AEXPR_IN:
		return e.evaluateIN(expr)

	case pg_query.A_Expr_Kind_AEXPR_LIKE:
		// Check if it's NOT LIKE (operator is !~~)
		negated := e.isNegatedOperator(expr, "!~~")
		return e.evaluateLike(expr, false, negated)

	case pg_query.A_Expr_Kind_AEXPR_ILIKE:
		// Check if it's NOT ILIKE (operator is !~~*)
		negated := e.isNegatedOperator(expr, "!~~*")
		return e.evaluateLike(expr, true, negated)

	case pg_query.A_Expr_Kind_AEXPR_BETWEEN,
		pg_query.A_Expr_Kind_AEXPR_NOT_BETWEEN,
		pg_query.A_Expr_Kind_AEXPR_BETWEEN_SYM,
		pg_query.A_Expr_Kind_AEXPR_NOT_BETWEEN_SYM:
		return e.evaluateBetween(expr)

	default:
		return nil, fmt.Errorf("unsupported expression kind for evaluation: %v", expr.Kind)
	}
}

// isNegatedOperator checks if the AExpr has a negated operator name
func (e *evaluator) isNegatedOperator(expr *pg_query.A_Expr, negatedOp string) bool {
	for _, name := range expr.Name {
		if s := name.GetString_(); s != nil && s.Sval == negatedOp {
			return true
		}
	}
	return false
}

func (e *evaluator) evaluateOperator(expr *pg_query.A_Expr) (any, error) {
	// Get operator name
	var opName string
	for _, name := range expr.Name {
		if s := name.GetString_(); s != nil {
			opName = s.Sval
			break
		}
	}

	// Handle NOT LIKE and NOT ILIKE (operators ~~ and ~~* with NOT prefix)
	if opName == "!~~" {
		return e.evaluateLike(expr, false, true)
	}
	if opName == "!~~*" {
		return e.evaluateLike(expr, true, true)
	}

	left, err := e.evaluate(expr.Lexpr)
	if err != nil {
		return nil, err
	}

	right, err := e.evaluate(expr.Rexpr)
	if err != nil {
		return nil, err
	}

	// NULL handling: any comparison with NULL returns NULL
	if left == nil || right == nil {
		return nil, nil
	}

	switch opName {
	case "=":
		return e.compareValues(left, right, "=")
	case "<>", "!=":
		return e.compareValues(left, right, "<>")
	case "<":
		return e.compareValues(left, right, "<")
	case ">":
		return e.compareValues(left, right, ">")
	case "<=":
		return e.compareValues(left, right, "<=")
	case ">=":
		return e.compareValues(left, right, ">=")
	case "~~":
		return e.evaluateLike(expr, false, false)
	case "~~*":
		return e.evaluateLike(expr, true, false)
	default:
		return nil, fmt.Errorf("unsupported operator: %s", opName)
	}
}

func (e *evaluator) compareValues(left, right any, op string) (bool, error) {
	// Try numeric comparison first
	leftNum, leftIsNum := toFloat64(left)
	rightNum, rightIsNum := toFloat64(right)

	if leftIsNum && rightIsNum {
		switch op {
		case "=":
			return leftNum == rightNum, nil
		case "<>":
			return leftNum != rightNum, nil
		case "<":
			return leftNum < rightNum, nil
		case ">":
			return leftNum > rightNum, nil
		case "<=":
			return leftNum <= rightNum, nil
		case ">=":
			return leftNum >= rightNum, nil
		}
	}

	// Fall back to string comparison
	leftStr := toString(left)
	rightStr := toString(right)

	switch op {
	case "=":
		return leftStr == rightStr, nil
	case "<>":
		return leftStr != rightStr, nil
	case "<":
		return leftStr < rightStr, nil
	case ">":
		return leftStr > rightStr, nil
	case "<=":
		return leftStr <= rightStr, nil
	case ">=":
		return leftStr >= rightStr, nil
	default:
		return false, fmt.Errorf("unsupported operator: %s", op)
	}
}

func (e *evaluator) evaluateIN(expr *pg_query.A_Expr) (any, error) {
	left, err := e.evaluate(expr.Lexpr)
	if err != nil {
		return nil, err
	}

	// NULL IN (...) returns NULL
	if left == nil {
		return nil, nil
	}

	// Get the list of values
	rightList, err := e.evaluate(expr.Rexpr)
	if err != nil {
		return nil, err
	}

	items, ok := rightList.([]any)
	if !ok {
		return nil, fmt.Errorf("IN list did not evaluate to a list")
	}

	// Check if it's NOT IN
	isNotIn := false
	for _, name := range expr.Name {
		if s := name.GetString_(); s != nil && s.Sval == "<>" {
			isNotIn = true
			break
		}
	}

	hasNull := false
	for _, item := range items {
		if item == nil {
			hasNull = true
			continue
		}
		eq, err := e.compareValues(left, item, "=")
		if err != nil {
			return nil, err
		}
		if eq {
			if isNotIn {
				return false, nil
			}
			return true, nil
		}
	}

	// If we have NULL in the list and didn't find a match, result is NULL
	if hasNull {
		return nil, nil
	}

	if isNotIn {
		return true, nil
	}
	return false, nil
}

func (e *evaluator) evaluateLike(expr *pg_query.A_Expr, caseInsensitive, negated bool) (any, error) {
	left, err := e.evaluate(expr.Lexpr)
	if err != nil {
		return nil, err
	}

	right, err := e.evaluate(expr.Rexpr)
	if err != nil {
		return nil, err
	}

	// NULL handling
	if left == nil || right == nil {
		return nil, nil
	}

	leftStr := toString(left)
	pattern := toString(right)

	// Convert SQL LIKE pattern to regex
	regex, err := likePatternToRegex(pattern, caseInsensitive)
	if err != nil {
		return nil, fmt.Errorf("invalid LIKE pattern: %w", err)
	}

	match := regex.MatchString(leftStr)
	if negated {
		return !match, nil
	}
	return match, nil
}

func (e *evaluator) evaluateBetween(expr *pg_query.A_Expr) (any, error) {
	left, err := e.evaluate(expr.Lexpr)
	if err != nil {
		return nil, err
	}

	// BETWEEN uses a list for the range [low, high]
	rightList, err := e.evaluate(expr.Rexpr)
	if err != nil {
		return nil, err
	}

	items, ok := rightList.([]any)
	if !ok || len(items) != 2 {
		return nil, fmt.Errorf("BETWEEN requires exactly 2 values")
	}

	low := items[0]
	high := items[1]

	// NULL handling
	if left == nil || low == nil || high == nil {
		return nil, nil
	}

	// Check left >= low AND left <= high
	geLow, err := e.compareValues(left, low, ">=")
	if err != nil {
		return nil, err
	}

	leHigh, err := e.compareValues(left, high, "<=")
	if err != nil {
		return nil, err
	}

	result := geLow && leHigh

	// Handle NOT BETWEEN
	if expr.Kind == pg_query.A_Expr_Kind_AEXPR_NOT_BETWEEN ||
		expr.Kind == pg_query.A_Expr_Kind_AEXPR_NOT_BETWEEN_SYM {
		return !result, nil
	}

	return result, nil
}

func (e *evaluator) evaluateBoolExpr(expr *pg_query.BoolExpr) (any, error) {
	if expr == nil {
		return nil, nil
	}

	switch expr.Boolop {
	case pg_query.BoolExprType_AND_EXPR:
		// Three-valued AND: returns false if any arg is false, NULL if any arg is NULL (and none are false)
		hasNull := false
		for _, arg := range expr.Args {
			val, err := e.evaluate(arg)
			if err != nil {
				return nil, err
			}
			if val == nil {
				hasNull = true
				continue
			}
			b, ok := val.(bool)
			if !ok {
				return nil, fmt.Errorf("AND operand did not evaluate to boolean")
			}
			if !b {
				return false, nil
			}
		}
		if hasNull {
			return nil, nil
		}
		return true, nil

	case pg_query.BoolExprType_OR_EXPR:
		// Three-valued OR: returns true if any arg is true, NULL if any arg is NULL (and none are true)
		hasNull := false
		for _, arg := range expr.Args {
			val, err := e.evaluate(arg)
			if err != nil {
				return nil, err
			}
			if val == nil {
				hasNull = true
				continue
			}
			b, ok := val.(bool)
			if !ok {
				return nil, fmt.Errorf("OR operand did not evaluate to boolean")
			}
			if b {
				return true, nil
			}
		}
		if hasNull {
			return nil, nil
		}
		return false, nil

	case pg_query.BoolExprType_NOT_EXPR:
		if len(expr.Args) != 1 {
			return nil, fmt.Errorf("NOT requires exactly 1 argument")
		}
		val, err := e.evaluate(expr.Args[0])
		if err != nil {
			return nil, err
		}
		if val == nil {
			return nil, nil
		}
		b, ok := val.(bool)
		if !ok {
			return nil, fmt.Errorf("NOT operand did not evaluate to boolean")
		}
		return !b, nil

	default:
		return nil, fmt.Errorf("unsupported boolean operator: %v", expr.Boolop)
	}
}

func (e *evaluator) evaluateNullTest(expr *pg_query.NullTest) (any, error) {
	if expr == nil {
		return nil, nil
	}

	val, err := e.evaluate(expr.Arg)
	if err != nil {
		return nil, err
	}

	isNull := val == nil

	switch expr.Nulltesttype {
	case pg_query.NullTestType_IS_NULL:
		return isNull, nil
	case pg_query.NullTestType_IS_NOT_NULL:
		return !isNull, nil
	default:
		return nil, fmt.Errorf("unsupported null test type: %v", expr.Nulltesttype)
	}
}

func (e *evaluator) evaluateBooleanTest(expr *pg_query.BooleanTest) (any, error) {
	if expr == nil {
		return nil, nil
	}

	val, err := e.evaluate(expr.Arg)
	if err != nil {
		return nil, err
	}

	switch expr.Booltesttype {
	case pg_query.BoolTestType_IS_TRUE:
		if val == nil {
			return false, nil
		}
		b, ok := val.(bool)
		return ok && b, nil

	case pg_query.BoolTestType_IS_NOT_TRUE:
		if val == nil {
			return true, nil
		}
		b, ok := val.(bool)
		return !ok || !b, nil

	case pg_query.BoolTestType_IS_FALSE:
		if val == nil {
			return false, nil
		}
		b, ok := val.(bool)
		return ok && !b, nil

	case pg_query.BoolTestType_IS_NOT_FALSE:
		if val == nil {
			return true, nil
		}
		b, ok := val.(bool)
		return !ok || b, nil

	case pg_query.BoolTestType_IS_UNKNOWN:
		return val == nil, nil

	case pg_query.BoolTestType_IS_NOT_UNKNOWN:
		return val != nil, nil

	default:
		return nil, fmt.Errorf("unsupported boolean test type: %v", expr.Booltesttype)
	}
}

func (e *evaluator) evaluateColumnRef(ref *pg_query.ColumnRef) (any, error) {
	if ref == nil || len(ref.Fields) == 0 {
		return nil, fmt.Errorf("invalid column reference")
	}

	field := ref.Fields[0]
	str := field.GetString_()
	if str == nil {
		return nil, fmt.Errorf("invalid column reference")
	}

	colName := str.Sval
	val, exists := e.row[colName]
	if !exists {
		// Column not in row - treat as NULL
		return nil, nil
	}

	return val, nil
}

func (e *evaluator) evaluateAConst(c *pg_query.A_Const) (any, error) {
	if c == nil {
		return nil, nil
	}

	// Check for NULL (Isnull field)
	if c.Isnull {
		return nil, nil
	}

	switch v := c.Val.(type) {
	case *pg_query.A_Const_Ival:
		return int64(v.Ival.Ival), nil
	case *pg_query.A_Const_Fval:
		f, err := strconv.ParseFloat(v.Fval.Fval, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid float: %w", err)
		}
		return f, nil
	case *pg_query.A_Const_Boolval:
		return v.Boolval.Boolval, nil
	case *pg_query.A_Const_Sval:
		return v.Sval.Sval, nil
	case *pg_query.A_Const_Bsval:
		return v.Bsval.Bsval, nil
	default:
		return nil, fmt.Errorf("unsupported constant type: %T", c.Val)
	}
}

func (e *evaluator) evaluateTypeCast(tc *pg_query.TypeCast) (any, error) {
	if tc == nil {
		return nil, nil
	}

	// For now, just evaluate the argument and ignore the type cast
	// A more sophisticated implementation would perform actual type conversion
	return e.evaluate(tc.Arg)
}

// Helper functions for type coercion

func toFloat64(v any) (float64, bool) {
	switch n := v.(type) {
	case int:
		return float64(n), true
	case int32:
		return float64(n), true
	case int64:
		return float64(n), true
	case float32:
		return float64(n), true
	case float64:
		return n, true
	case string:
		f, err := strconv.ParseFloat(n, 64)
		if err == nil {
			return f, true
		}
	}
	return 0, false
}

func toString(v any) string {
	switch s := v.(type) {
	case string:
		return s
	case int:
		return strconv.Itoa(s)
	case int32:
		return strconv.FormatInt(int64(s), 10)
	case int64:
		return strconv.FormatInt(s, 10)
	case float32:
		return strconv.FormatFloat(float64(s), 'f', -1, 32)
	case float64:
		return strconv.FormatFloat(s, 'f', -1, 64)
	case bool:
		if s {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprintf("%v", v)
	}
}

// likePatternToRegex converts a SQL LIKE pattern to a Go regex.
// % matches any sequence of characters, _ matches any single character.
func likePatternToRegex(pattern string, caseInsensitive bool) (*regexp.Regexp, error) {
	var sb strings.Builder
	sb.WriteString("^")

	if caseInsensitive {
		sb.WriteString("(?i)")
	}

	i := 0
	for i < len(pattern) {
		c := pattern[i]
		switch c {
		case '%':
			sb.WriteString(".*")
		case '_':
			sb.WriteString(".")
		case '\\':
			// Escape sequence
			if i+1 < len(pattern) {
				next := pattern[i+1]
				if next == '%' || next == '_' || next == '\\' {
					sb.WriteString(regexp.QuoteMeta(string(next)))
					i++
				} else {
					sb.WriteString(regexp.QuoteMeta(string(c)))
				}
			} else {
				sb.WriteString(regexp.QuoteMeta(string(c)))
			}
		default:
			// Escape special regex characters
			sb.WriteString(regexp.QuoteMeta(string(c)))
		}
		i++
	}

	sb.WriteString("$")
	return regexp.Compile(sb.String())
}
