import React, { createContext, useContext, useEffect, useState } from "react";
import { AppState } from "react-native";
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthError, createClient } from '@supabase/supabase-js';

export type UserId = string

interface AuthState {
  userId: UserId | null,
  jwtToken: string | null,
}

// Initiate your Supabase client
const supabaseUrl = process.env.EXPO_PUBLIC_ELECTRIC_SUPABASE_URL ?? 'dummy'
const supabaseAnonKey = process.env.EXPO_PUBLIC_ELECTRIC_SUPABASE_ANON_KEY ?? 'dummy'
export const supabase = createClient(supabaseUrl, supabaseAnonKey,  {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})


const AuthContext = createContext<AuthState>({
  userId: null,
  jwtToken: null,
});

function AuthProvider({
  children,
  onSignOut,
} : {
  children: React.ReactNode,
  onSignOut?: () => void
}) {
  const [ state, setState ] = useState<AuthState>({
    userId: null,
    jwtToken: null
  })

  // Tells Supabase Auth to continuously refresh the session automatically if
  // the app is in the foreground. When this is added, you will continue to receive
  // `onAuthStateChange` events with the `TOKEN_REFRESHED` or `SIGNED_OUT` event
  // if the user's session is terminated. This should only be registered once.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      switch (state) {
        case 'active':
          supabase.auth.startAutoRefresh()
          break
        default:
          supabase.auth.stopAutoRefresh()
      }
    })

    return subscription.remove
  })

  // Listen to auth events for keeping the user and JWT token up to date
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      switch (event) {
        case 'INITIAL_SESSION':
        case 'SIGNED_IN':
        case 'TOKEN_REFRESHED':
          setState({
            userId: session?.user.id ?? null,
            jwtToken: session?.access_token ?? null
          })
          break
        case 'SIGNED_OUT':
          setState({
            userId: null,
            jwtToken: null
          })
          onSignOut?.()
          break
      }
    })
    return subscription.unsubscribe
  })

  return (
    <AuthContext.Provider value={state}>
      {children}
    </AuthContext.Provider>
  );
}


/**
 * Retrieve the current authenticated user ID if present
 */
export function useAuthenticatedUser() : UserId | null {
  const { userId } = useContext(AuthContext)
  return userId
}

/**
 * Retrieve the current JWT access token if present
 */
export function useAccessToken() : string | null {
  const { jwtToken } = useContext(AuthContext)
  return jwtToken
}

interface EmailPasswordInput {
  email: string,
  password: string
}

/**
 * Signs the user up with an account with given email and password.
 * Check if an error is returned as operation does not throw.
 */
export async function signUp(
  { email, password } : EmailPasswordInput
) : Promise<{ error: AuthError | null }> {
  const { error } = await supabase.auth.signUp({
    email,
    password
  })
  return { error }
}

/**
 * Signs the user with the given email and password in.
 * Check if an error is returned as operation does not throw.
 */
export async function signIn(
  { email, password } : EmailPasswordInput
) : Promise<{ error: AuthError | null }> {
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  })
  return { error }
}

export default AuthProvider