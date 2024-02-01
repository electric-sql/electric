import React from 'react'
import { Redirect } from 'expo-router'
import { useAuthenticationState } from '../components/AuthProvider'
import LoadingView from '../components/LoadingView'

export default function Index () {
  const { authenticated, initializing } = useAuthenticationState()
  if (initializing) return <LoadingView />
  if (!authenticated) return <Redirect href="/sign_in" />
  return <Redirect href="/shopping_lists" />
}