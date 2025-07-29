import "react-native-random-uuid";
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  FlatList,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { useLiveQuery } from "@tanstack/react-db";
import { StatusBar } from "expo-status-bar";
import { apiClient, hostname } from "../src/utils/api-client";
import { selectTodoSchema } from "../src/db/schema";
import { electricCollectionOptions } from "@tanstack/db-collections";
import { createCollection } from "@tanstack/react-db";
import { parseISO } from "date-fns";

const todoCollection = createCollection(
  electricCollectionOptions({
    id: "todos",
    schema: selectTodoSchema,
    // Electric syncs data using "shapes". These are filtered views
    // on database tables that Electric keeps in sync for you.
    shapeOptions: {
      url: `http://${hostname}:3000/v1/shape`,
      params: {
        table: "todos",
      },
      parser: {
        // Parse timestamp columns into JavaScript Date objects
        timestamptz: (date: string) => {
          return parseISO(date);
        },
      },
    },
    onInsert: async ({ transaction }) => {
      const { txid } = await apiClient.createTodo(
        transaction.mutations[0].modified,
      );

      return { txid: String(txid) };
    },
    onUpdate: async ({ transaction }) => {
      const {
        original: { id },
        changes,
      } = transaction.mutations[0];
      const { txid } = await apiClient.updateTodo(id, changes);

      return { txid: String(txid) };
    },
    onDelete: async ({ transaction }) => {
      const { id } = transaction.mutations[0].original;
      const { txid } = await apiClient.deleteTodo(id);

      return { txid: String(txid) };
    },
    getKey: (item) => item.id,
  }),
);

export default function HomeScreen() {
  const [newTodoText, setNewTodoText] = useState("");

  // Query todos from the collection
  const { data: todos } = useLiveQuery((q) => q.from({ todoCollection }));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Todo App</Text>

      {/* Add new todo */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={newTodoText}
          onChangeText={setNewTodoText}
          placeholder="Add a new todo..."
        />
        <Button
          title="Add"
          onPress={() => {
            if (newTodoText.length > 0) {
              todoCollection.insert({
                // Random temporary id.
                id: Math.floor(Math.random() * 1000000),
                text: newTodoText,
                completed: false,
                created_at: new Date(),
                updated_at: new Date(),
              });
              setNewTodoText("");
            }
          }}
        />
      </View>

      {/* Todo list */}
      <FlatList
        data={todos}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.todoItem}>
            {/* update the todo */}
            <TouchableOpacity
              style={styles.todoCheckbox}
              onPress={() => {
                todoCollection.update(item.id, (draft) => {
                  draft.completed = !draft.completed;
                });
              }}
            >
              {item.completed && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
            <Text
              style={[
                styles.todoText,
                item.completed && styles.completedTodoText,
              ]}
            >
              {item.text}
            </Text>
            {/* delete the todo */}
            <TouchableOpacity onPress={() => todoCollection.delete(item.id)}>
              <Text style={styles.deleteButton}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginTop: 40,
    marginBottom: 20,
    textAlign: "center",
  },
  inputContainer: {
    flexDirection: "row",
    marginBottom: 20,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 10,
    marginRight: 10,
    borderRadius: 4,
  },
  todoItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  todoCheckbox: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 4,
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  checkmark: {
    color: "#0080ff",
  },
  todoText: {
    flex: 1,
  },
  completedTodoText: {
    textDecorationLine: "line-through",
    color: "#aaa",
  },
  deleteButton: {
    color: "#ff3b30",
    fontWeight: "bold",
    fontSize: 16,
  },
});
