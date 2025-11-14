use serde::{Deserialize, Serialize};
use roaring::RoaringBitmap;
use std::collections::HashMap;

/// Compiled predicate for efficient evaluation
/// Represents a WHERE clause compiled to bytecode
#[derive(Clone, Serialize, Deserialize)]
pub struct CompiledPredicate {
    /// Bytecode instructions
    bytecode: Vec<Instruction>,

    /// Columns referenced by this predicate (for quick intersection checks)
    referenced_columns: Vec<u16>,

    /// Constant data (strings, bitmaps, etc.)
    constants: Vec<Constant>,
}

impl Default for CompiledPredicate {
    fn default() -> Self {
        Self {
            bytecode: Vec::new(),
            referenced_columns: Vec::new(),
            constants: Vec::new(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
enum Instruction {
    // Stack operations
    PushNull,
    PushTrue,
    PushFalse,
    PushConst(u16),       // Push constant[index] onto stack
    LoadColumn(u16),      // Load column value onto stack
    LoadOldColumn(u16),   // Load old (pre-update) column value

    // Comparison operators
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,

    // Logical operators
    And,
    Or,
    Not,

    // Special operators
    IsNull,
    IsNotNull,
    In(u16),              // Check if value in constant set[index]
    Between,              // Check if value between two stack values
    LikePrefix(u16),      // LIKE 'prefix%' - constant[index] is prefix

    // Control flow
    JumpIfFalse(u16),     // Jump forward by offset if top of stack is false
    Jump(u16),            // Unconditional jump
    Return,               // Return top of stack as result
}

#[derive(Clone, Serialize, Deserialize)]
enum Constant {
    Integer(i64),
    Float(f64),
    String(String),
    IntSet(Vec<i64>),     // For IN clauses with small sets
    IntBitmap(Vec<u8>),   // For IN clauses with large sets (serialized Roaring)
}

impl CompiledPredicate {
    /// Create a new predicate from bytecode
    pub fn new(
        bytecode: Vec<Instruction>,
        referenced_columns: Vec<u16>,
        constants: Vec<Constant>,
    ) -> Self {
        Self {
            bytecode,
            referenced_columns,
            constants,
        }
    }

    /// Check if any referenced columns intersect with changed columns
    pub fn columns_intersect(&self, changed_columns: &[u16]) -> bool {
        if self.referenced_columns.is_empty() {
            return true; // No column filter, always evaluate
        }

        for col in changed_columns {
            if self.referenced_columns.contains(col) {
                return true;
            }
        }
        false
    }

    /// Evaluate the predicate against a row
    /// Returns true if the row matches the WHERE clause
    pub fn evaluate(&self, old_row: Option<&[u8]>, new_row: Option<&[u8]>) -> bool {
        let mut vm = PredicateVM::new(self, old_row, new_row);
        vm.execute()
    }

    /// Serialize to bytes for passing to Elixir
    pub fn serialize(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }

    /// Deserialize from bytes
    pub fn deserialize(bytes: &[u8]) -> Result<Self, String> {
        serde_json::from_slice(bytes).map_err(|e| e.to_string())
    }
}

/// Predicate VM: stack-based bytecode interpreter
pub struct PredicateVM<'a> {
    predicate: &'a CompiledPredicate,
    old_row: Option<&'a [u8]>,
    new_row: Option<&'a [u8]>,
    stack: Vec<Value>,
    pc: usize,
}

#[derive(Clone, Debug)]
enum Value {
    Null,
    Bool(bool),
    Integer(i64),
    Float(f64),
    String(String),
}

impl<'a> PredicateVM<'a> {
    fn new(
        predicate: &'a CompiledPredicate,
        old_row: Option<&'a [u8]>,
        new_row: Option<&'a [u8]>,
    ) -> Self {
        Self {
            predicate,
            old_row,
            new_row,
            stack: Vec::with_capacity(16),
            pc: 0,
        }
    }

    fn execute(&mut self) -> bool {
        while self.pc < self.predicate.bytecode.len() {
            let instruction = &self.predicate.bytecode[self.pc];
            self.pc += 1;

            match instruction {
                Instruction::PushNull => self.stack.push(Value::Null),
                Instruction::PushTrue => self.stack.push(Value::Bool(true)),
                Instruction::PushFalse => self.stack.push(Value::Bool(false)),

                Instruction::PushConst(idx) => {
                    if let Some(constant) = self.predicate.constants.get(*idx as usize) {
                        let value = match constant {
                            Constant::Integer(i) => Value::Integer(*i),
                            Constant::Float(f) => Value::Float(*f),
                            Constant::String(s) => Value::String(s.clone()),
                            _ => Value::Null,
                        };
                        self.stack.push(value);
                    } else {
                        self.stack.push(Value::Null);
                    }
                }

                Instruction::LoadColumn(col_id) => {
                    let value = self.load_column(*col_id, false);
                    self.stack.push(value);
                }

                Instruction::LoadOldColumn(col_id) => {
                    let value = self.load_column(*col_id, true);
                    self.stack.push(value);
                }

                Instruction::Eq => self.binary_op(|a, b| self.compare_eq(a, b)),
                Instruction::Ne => self.binary_op(|a, b| !self.compare_eq(a, b)),
                Instruction::Lt => self.binary_op(|a, b| self.compare_lt(a, b)),
                Instruction::Le => self.binary_op(|a, b| self.compare_lt(a, b) || self.compare_eq(a, b)),
                Instruction::Gt => self.binary_op(|a, b| !self.compare_lt(a, b) && !self.compare_eq(a, b)),
                Instruction::Ge => self.binary_op(|a, b| !self.compare_lt(a, b)),

                Instruction::And => self.logical_and(),
                Instruction::Or => self.logical_or(),
                Instruction::Not => self.logical_not(),

                Instruction::IsNull => {
                    if let Some(val) = self.stack.pop() {
                        self.stack.push(Value::Bool(matches!(val, Value::Null)));
                    }
                }

                Instruction::IsNotNull => {
                    if let Some(val) = self.stack.pop() {
                        self.stack.push(Value::Bool(!matches!(val, Value::Null)));
                    }
                }

                Instruction::In(const_idx) => {
                    self.op_in(*const_idx);
                }

                Instruction::Between => {
                    self.op_between();
                }

                Instruction::LikePrefix(const_idx) => {
                    self.op_like_prefix(*const_idx);
                }

                Instruction::JumpIfFalse(offset) => {
                    if let Some(Value::Bool(false)) = self.stack.last() {
                        self.pc += *offset as usize;
                    }
                    self.stack.pop();
                }

                Instruction::Jump(offset) => {
                    self.pc += *offset as usize;
                }

                Instruction::Return => break,
            }
        }

        // Return top of stack as boolean result
        match self.stack.last() {
            Some(Value::Bool(b)) => *b,
            _ => false,
        }
    }

    fn load_column(&self, _col_id: u16, use_old: bool) -> Value {
        // Simplified: In production, parse row bytes based on column schema
        // For prototype, just return mock values
        let row = if use_old { self.old_row } else { self.new_row };

        if row.is_some() {
            // Mock: extract value from row bytes
            Value::Integer(42)
        } else {
            Value::Null
        }
    }

    fn binary_op<F>(&mut self, op: F)
    where
        F: FnOnce(&Value, &Value) -> bool,
    {
        if let (Some(b), Some(a)) = (self.stack.pop(), self.stack.pop()) {
            let result = op(&a, &b);
            self.stack.push(Value::Bool(result));
        } else {
            self.stack.push(Value::Bool(false));
        }
    }

    fn compare_eq(&self, a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Null, Value::Null) => true,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            (Value::Integer(a), Value::Integer(b)) => a == b,
            (Value::Float(a), Value::Float(b)) => (a - b).abs() < f64::EPSILON,
            (Value::String(a), Value::String(b)) => a == b,
            _ => false,
        }
    }

    fn compare_lt(&self, a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Integer(a), Value::Integer(b)) => a < b,
            (Value::Float(a), Value::Float(b)) => a < b,
            (Value::String(a), Value::String(b)) => a < b,
            _ => false,
        }
    }

    fn logical_and(&mut self) {
        if let (Some(Value::Bool(b)), Some(Value::Bool(a))) = (self.stack.pop(), self.stack.pop()) {
            self.stack.push(Value::Bool(a && b));
        } else {
            self.stack.push(Value::Bool(false));
        }
    }

    fn logical_or(&mut self) {
        if let (Some(Value::Bool(b)), Some(Value::Bool(a))) = (self.stack.pop(), self.stack.pop()) {
            self.stack.push(Value::Bool(a || b));
        } else {
            self.stack.push(Value::Bool(false));
        }
    }

    fn logical_not(&mut self) {
        if let Some(Value::Bool(a)) = self.stack.pop() {
            self.stack.push(Value::Bool(!a));
        } else {
            self.stack.push(Value::Bool(false));
        }
    }

    fn op_in(&mut self, const_idx: u16) {
        if let Some(value) = self.stack.pop() {
            if let Some(constant) = self.predicate.constants.get(const_idx as usize) {
                let result = match (&value, constant) {
                    (Value::Integer(v), Constant::IntSet(set)) => set.contains(v),
                    (Value::Integer(v), Constant::IntBitmap(bytes)) => {
                        // Deserialize Roaring bitmap and check
                        if let Ok(bitmap) = RoaringBitmap::deserialize_from(&bytes[..]) {
                            *v >= 0 && bitmap.contains(*v as u32)
                        } else {
                            false
                        }
                    }
                    _ => false,
                };
                self.stack.push(Value::Bool(result));
            } else {
                self.stack.push(Value::Bool(false));
            }
        }
    }

    fn op_between(&mut self) {
        if let (Some(high), Some(low), Some(value)) =
            (self.stack.pop(), self.stack.pop(), self.stack.pop()) {
            let result = !self.compare_lt(&value, &low) && !self.compare_lt(&high, &value);
            self.stack.push(Value::Bool(result));
        } else {
            self.stack.push(Value::Bool(false));
        }
    }

    fn op_like_prefix(&mut self, const_idx: u16) {
        if let Some(Value::String(s)) = self.stack.pop() {
            if let Some(Constant::String(prefix)) = self.predicate.constants.get(const_idx as usize) {
                self.stack.push(Value::Bool(s.starts_with(prefix)));
            } else {
                self.stack.push(Value::Bool(false));
            }
        } else {
            self.stack.push(Value::Bool(false));
        }
    }
}

/// Predicate compiler: parse WHERE clause and compile to bytecode
/// In production, use libpg_query via pg_query_ex
pub struct PredicateCompiler {
    bytecode: Vec<Instruction>,
    constants: Vec<Constant>,
    referenced_columns: Vec<u16>,
    column_map: HashMap<String, u16>,
}

impl PredicateCompiler {
    pub fn new(column_map: HashMap<String, u16>) -> Self {
        Self {
            bytecode: Vec::new(),
            constants: Vec::new(),
            referenced_columns: Vec::new(),
            column_map,
        }
    }

    /// Compile a simple WHERE clause
    /// Format: "column_name = value" or "column_name IN (v1, v2, v3)"
    /// Production: use pg_query_ex to parse full PostgreSQL WHERE syntax
    pub fn compile_simple(&mut self, where_clause: &str) -> Result<CompiledPredicate, String> {
        // Simplified parser for prototype
        // Production would use libpg_query here

        if where_clause.contains(" IN ") {
            self.compile_in_clause(where_clause)?;
        } else if where_clause.contains('=') {
            self.compile_equality(where_clause)?;
        } else {
            return Err("Unsupported WHERE clause".to_string());
        }

        self.bytecode.push(Instruction::Return);

        Ok(CompiledPredicate::new(
            self.bytecode.clone(),
            self.referenced_columns.clone(),
            self.constants.clone(),
        ))
    }

    fn compile_equality(&mut self, clause: &str) -> Result<(), String> {
        let parts: Vec<&str> = clause.split('=').map(|s| s.trim()).collect();
        if parts.len() != 2 {
            return Err("Invalid equality clause".to_string());
        }

        let col_name = parts[0];
        let value = parts[1];

        let col_id = self.get_column_id(col_name)?;
        self.referenced_columns.push(col_id);

        self.bytecode.push(Instruction::LoadColumn(col_id));

        // Parse value
        if let Ok(i) = value.parse::<i64>() {
            let const_idx = self.constants.len() as u16;
            self.constants.push(Constant::Integer(i));
            self.bytecode.push(Instruction::PushConst(const_idx));
        } else {
            return Err("Unsupported value type".to_string());
        }

        self.bytecode.push(Instruction::Eq);

        Ok(())
    }

    fn compile_in_clause(&mut self, clause: &str) -> Result<(), String> {
        // Parse "column IN (v1, v2, v3)"
        let parts: Vec<&str> = clause.split(" IN ").map(|s| s.trim()).collect();
        if parts.len() != 2 {
            return Err("Invalid IN clause".to_string());
        }

        let col_name = parts[0];
        let values_str = parts[1].trim_matches(|c| c == '(' || c == ')');

        let col_id = self.get_column_id(col_name)?;
        self.referenced_columns.push(col_id);

        self.bytecode.push(Instruction::LoadColumn(col_id));

        // Parse values
        let values: Result<Vec<i64>, _> = values_str
            .split(',')
            .map(|s| s.trim().parse::<i64>())
            .collect();

        match values {
            Ok(vals) => {
                let const_idx = self.constants.len() as u16;
                self.constants.push(Constant::IntSet(vals));
                self.bytecode.push(Instruction::In(const_idx));
            }
            Err(_) => return Err("Invalid IN values".to_string()),
        }

        Ok(())
    }

    fn get_column_id(&self, col_name: &str) -> Result<u16, String> {
        self.column_map
            .get(col_name)
            .copied()
            .ok_or_else(|| format!("Unknown column: {}", col_name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_predicate() {
        let mut compiler = PredicateCompiler::new(
            [("user_id".to_string(), 0)].iter().cloned().collect()
        );

        let predicate = compiler.compile_simple("user_id = 42").unwrap();

        // Mock row data (in production, would be actual row bytes)
        let result = predicate.evaluate(None, Some(&[]));
        // Result depends on mock data in load_column
        println!("Predicate result: {}", result);
    }

    #[test]
    fn test_in_predicate() {
        let mut compiler = PredicateCompiler::new(
            [("status".to_string(), 1)].iter().cloned().collect()
        );

        let predicate = compiler.compile_simple("status IN (1, 2, 3)").unwrap();

        let result = predicate.evaluate(None, Some(&[]));
        println!("IN predicate result: {}", result);
    }
}
