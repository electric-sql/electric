import React from "react";
import { Stack } from "expo-router";

/**
 * Root layout component that provides the TanStack DB context
 * to all routes in the application
 */
export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: "Todo App",
          headerShown: false,
        }}
      />
    </Stack>
  );
}
