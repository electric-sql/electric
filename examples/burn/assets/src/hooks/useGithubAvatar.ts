import { useEffect, useState, useRef } from 'react'

export function useGithubAvatar(username: string) {
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined)
  const imgRef = useRef<HTMLImageElement>(undefined)

  if (!imgRef.current) {
    imgRef.current = new Image()
    imgRef.current.onerror = () => setImageUrl(undefined)
  }

  useEffect(() => {
    const img = imgRef.current!

    if (username.length < 2) {
      setImageUrl(undefined)

      return
    }

    const timeoutId = setTimeout(() => {
      const encodedUsername = encodeURIComponent(username)
      const url = `https://github.com/${encodedUsername}.png?size=120`

      img.onload = () => setImageUrl(url)
      img.src = url
    }, 500)

    return () => {
      clearTimeout(timeoutId)

      img.src = ''
    }
  }, [username])

  return imageUrl
}
