import base64 from 'react-native-base64'
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export type UserId = string

// Initiate your Supabase client
const supabaseUrl = process.env.EXPO_PUBLIC_ELECTRIC_SUPABASE_URL ?? 'dummy'
const supabaseAnonKey = process.env.EXPO_PUBLIC_ELECTRIC_SUPABASE_ANON_KEY ?? 'dummy'
const supabase = createClient(supabaseUrl, supabaseAnonKey,  {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

/**
 * Signs the user up with an account with given email and password.
 */
export async function signUp(email: string, password: string) : Promise<UserId | undefined> {
  const { data } = await supabase.auth.signUp({
    email,
    password
  })
  return data.user?.id
}

/**
 * Signs the user with the given email and password in.
 */
export async function signIn(email: string, password: string) : Promise<UserId | undefined> {
  const { data } = await supabase.auth.signInWithPassword({
    email,
    password
  })
  return data.user?.id
}

export async function authToken () : Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw Error('No valid session present')
  return session.access_token
}




// This is just a demo. In a real app, the user ID would
// usually come from somewhere else :)
export const dummyUserId = "40609783-9943-4035-8db0-fce39798e64e"

// Generate an insecure authentication JWT.
// See https://electric-sql.com/docs/usage/auth for more details.
export async function insecureAuthToken(): Promise<string> {
  
  const claims = {'user_id': dummyUserId}
  const header = { alg: 'none' }
  return `${encode(header)}.${encode(claims)}.`
}

function encode(data: object): string {
  const str = JSON.stringify(data)
  const bytes = new TextEncoder().encode(str)

  const binArray = Array.from(bytes, (x) => String.fromCodePoint(x))
  const binString = binArray.join('')
  const encoded = base64.encode(binString)

  return encoded.replace(/\+/g, '-').replace(/\//, '_').replace(/=+$/, '')
}