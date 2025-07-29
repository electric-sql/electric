import Constants from "expo-constants";
import { Todo } from "../db/schema";

export const hostname = new URL(Constants.linkingUri).hostname;
const API_BASE_URL = `http://${hostname}:3001/api`; // Port 3001 from api/index.ts

/**
 * Standalone API client for interacting with the Express backend.
 */
export const apiClient = {
  async _request(path: string, options: RequestInit = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      // For GET single item, returning null is a valid outcome for a 404.
      if (
        response.status === 404 &&
        (options.method === "GET" || !options.method)
      ) {
        return null;
      }
      const errorBody = await response.text();
      const method = options.method || "GET";
      throw new Error(
        `HTTP Error: ${response.status} for ${method} ${path}. Body: ${errorBody}`,
      );
    }

    // The API always returns JSON, even for DELETE, so we can safely parse it.
    return response.json();
  },

  async createTodo(
    todoData: Partial<Omit<Todo, "id" | "created_at" | "updated_at">>,
  ): Promise<{ todo: Todo; txid: number }> {
    return this._request("/todos", {
      method: "POST",
      body: JSON.stringify(todoData),
    });
  },

  async updateTodo(
    id: number,
    todoData: Partial<Omit<Todo, "id" | "created_at" | "updated_at">>,
  ): Promise<{ todo: Todo; txid: number }> {
    return this._request(`/todos/${id}`, {
      method: "PUT",
      body: JSON.stringify(todoData),
    });
  },

  async deleteTodo(id: number): Promise<{ success: boolean; txid: number }> {
    return this._request(`/todos/${id}`, { method: "DELETE" });
  },
};
