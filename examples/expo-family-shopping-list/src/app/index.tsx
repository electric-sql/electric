import React from 'react'
import { Redirect } from 'expo-router'
import { useAuthenticationState } from '../components/AuthProvider'

export default function Index () {
  const { authenticated, initializing } = useAuthenticationState()
  console.log(authenticated, initializing)
  if (initializing) return null
  if (!authenticated) return <Redirect href="/sign_in" />
  return <Redirect href="/shopping_lists" />
}