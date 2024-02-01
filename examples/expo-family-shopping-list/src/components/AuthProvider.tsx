import React, { createContext, useContext, useEffect, useState } from "react";
import { AppState } from "react-native";
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export type UserId = string

interface EmailPasswordInput {
  email: string,
  password: string
}

interface TokenData {
  userId: string,
  jwtToken: string
}
interface AuthError {
  message: string
}

interface AuthState {
  initializing: boolean,
  operationInProgress: boolean,
  userId?: UserId,
  jwtToken?: string,
}

interface AuthActions {
  signIn: (input: EmailPasswordInput) => Promise<{ error: AuthError | null }>,
  signUp: (input: EmailPasswordInput) => Promise<{ error: AuthError | null }>,
  signOut: () => Promise<{ error: AuthError | null }>,
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


const AuthContext = createContext<{
  state: AuthState,
  actions: AuthActions,
} | null>(null)

function AuthProvider({
  children,
  onSignOut,
} : {
  children: React.ReactNode,
  onSignOut?: () => void
}) {
  const [ operationInProgress, setOperationInProgress ] = useState(false)
  const [ initializing, setInitializing ] = useState(true)
  const [ tokenData, setTokenData ] = useState<TokenData | null>(null)

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
  }, [])

  // Listen to auth events for keeping the user and JWT token up to date
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      switch (event) {
        case 'INITIAL_SESSION':
        case 'SIGNED_IN':
        case 'TOKEN_REFRESHED':
          setInitializing(false)
          setTokenData(session !== null ? {
            userId: session.user.id ,
            jwtToken: session.access_token
          } : null)
          break
        case 'SIGNED_OUT':
          setTokenData(null)
          onSignOut?.()
          break
      }
    })
    return subscription.unsubscribe
  }, [])

  /**
   * Signs the user up with an account with given email and password.
   * Check if an error is returned as operation does not throw.
   */
  async function signUp(
    { email, password } : EmailPasswordInput
  ) : Promise<{ error: AuthError | null }> {
    setOperationInProgress(true)
    const { error } = await supabase.auth.signUp({
      email,
      password
    })
    setOperationInProgress(false)
    return { error }
  }

  /**
   * Signs the user with the given email and password in.
   * Check if an error is returned as operation does not throw.
   */
  async function signIn(
    { email, password } : EmailPasswordInput
  ) : Promise<{ error: AuthError | null }> {
    setOperationInProgress(true)
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    setOperationInProgress(false)

    // special case of successful signup but still needing verification
    if (!error && !data.session) {
      return {
        error: {
          message: 'Please check your inbox for email verification!'
        }
      }
    }

    return { error }
  }

  /**
   * Signs the user out.
   * Check if an error is returned as operation does not throw.
   */
  async function signOut() : Promise<{ error: AuthError | null }> {
    setOperationInProgress(true)
    setTokenData(null)
    const { error } = await supabase.auth.signOut()
    setOperationInProgress(false)
    return { error }
  }

  const value = {
    state: {
      ...tokenData,
      initializing,
      operationInProgress,
    },
    actions: {
      signIn,
      signUp,
      signOut
    }
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}


/**
 * Retrieve the current authenticated user ID if present
 */
export function useAuthenticatedUser() : UserId | null {
  const { state: { userId } } = useContext(AuthContext)!
  return userId ?? null
}

/**
 * Retrieve the current JWT access token if present
 */
export function useAccessToken() : string | null {
  const { state: { jwtToken } } = useContext(AuthContext)!
  return jwtToken ?? null
}

/**
 * Returns whether current user is authenticated
 */
export function useAuthenticationState() {
  return {
    authenticated: useAuthenticatedUser() != null,
    initializing: useContext(AuthContext)!.state.initializing,
  }
}

/**
 * Returns authentication actions such as signing in or out,
 * as well as a flag to indicate if any action is active
 */
export function useAuthActions() {
  return {
    ...useContext(AuthContext)!.actions,
    loading: useContext(AuthContext)!.state.operationInProgress,
  }
}

export default AuthProvider