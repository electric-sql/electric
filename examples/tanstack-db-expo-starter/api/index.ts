import express from "express";
import cors from "cors";
import { db } from "../src/db";
import { todos } from "../src/db/schema";
import { validateInsertTodo, validateUpdateTodo } from "../src/db/schema";
import { sql, eq } from "drizzle-orm";

// Create Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get(`/api/health`, (_req, res) => {
  res.status(200).json({ status: `ok` });
});

// Generate a transaction ID
async function generateTxId(tx: any): Promise<number> {
  // This is specific to postgres and how electricsql works
  const [{ txid }] = await tx.execute(sql`SELECT txid_current() as txid`);
  return Number(txid);
}

// ===== TODOS API =====

// POST create a new todo
app.post(`/api/todos`, async (req, res) => {
  try {
    const todoData = validateInsertTodo(req.body);

    const result = await db.transaction(async (tx) => {
      const txid = await generateTxId(tx);
      const [newTodo] = await tx.insert(todos).values(todoData).returning();
      return { todo: newTodo, txid };
    });

    res.status(201).json(result);
  } catch (error) {
    console.error(`Error creating todo:`, error);
    res.status(500).json({
      error: `Failed to create todo`,
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// PUT update a todo
app.put(`/api/todos/:id`, async (req, res) => {
  try {
    const { id } = req.params;
    const todoData = validateUpdateTodo(req.body);

    const result = await db.transaction(async (tx) => {
      const txid = await generateTxId(tx);
      const [updatedTodo] = await tx
        .update(todos)
        .set({ ...todoData, updated_at: new Date() })
        .where(eq(todos.id, Number(id)))
        .returning();

      if (!updatedTodo) {
        throw new Error(`Todo not found`);
      }
      return { todo: updatedTodo, txid };
    });

    res.status(200).json(result);
  } catch (error) {
    if (error instanceof Error && error.message === `Todo not found`) {
      return res.status(404).json({ error: `Todo not found` });
    }

    console.error(`Error updating todo:`, error);
    res.status(500).json({
      error: `Failed to update todo`,
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// DELETE a todo
app.delete(`/api/todos/:id`, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.transaction(async (tx) => {
      const txid = await generateTxId(tx);
      const [deleted] = await tx
        .delete(todos)
        .where(eq(todos.id, Number(id)))
        .returning({ id: todos.id });

      if (!deleted) {
        throw new Error(`Todo not found`);
      }
      return { success: true, txid };
    });

    res.status(200).json(result);
  } catch (error) {
    if (error instanceof Error && error.message === `Todo not found`) {
      return res.status(404).json({ error: `Todo not found` });
    }

    console.error(`Error deleting todo:`, error);
    res.status(500).json({
      error: `Failed to delete todo`,
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
