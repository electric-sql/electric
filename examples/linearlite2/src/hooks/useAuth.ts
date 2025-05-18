import { useState, useEffect } from 'react'

export function useAuth() {
  const [username, setUsername] = useState<string | null>(
    localStorage.getItem(`username`)
  )

  const isLoggedIn = !!username

  const signOut = () => {
    localStorage.removeItem(`username`)
    setUsername(null)
    window.dispatchEvent(new Event(`storage`))
  }

  const signIn = (username: string) => {
    localStorage.setItem(`username`, username)
    setUsername(username)
    window.dispatchEvent(new Event(`storage`))
  }

  // Listen for localStorage changes to detect login/logout
  useEffect(() => {
    const checkAuth = () => {
      const currentUser = localStorage.getItem(`username`)
      if (currentUser !== username) {
        setUsername(currentUser)
      }
    }

    // Add storage event listener to detect changes from other tabs
    window.addEventListener(`storage`, checkAuth)

    return () => {
      window.removeEventListener(`storage`, checkAuth)
    }
  }, [username])

  return { username, isLoggedIn, signOut, signIn }
}
