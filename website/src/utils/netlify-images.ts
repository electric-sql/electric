/**
 * Generate optimized image URL using Netlify Image CDN
 * @param imagePath - The path to the image (can be relative or absolute URL)
 * @param options - Image optimization options
 * @returns Netlify CDN URL with optimization parameters
 */
export function getNetlifyImageUrl(
  imagePath: string,
  options: {
    width?: number
    height?: number
    fit?: `contain` | `cover` | `fill` | `inside` | `outside`
    format?: `jpg` | `png` | `webp` | `avif`
    quality?: number
  } = {}
): string {
  const { width, height, fit = `cover`, format = `jpg`, quality = 80 } = options

  // Get current origin (works in browser and SSR)
  // In SSR: use Netlify's DEPLOY_PRIME_URL or fallback to production
  // In browser: use current window location
  const origin =
    typeof window !== `undefined`
      ? window.location.origin
      : import.meta.env?.DEPLOY_PRIME_URL || `https://electric-sql.com`

  // Convert relative paths to absolute URLs using current origin
  const fullImageUrl = imagePath.startsWith(`http`)
    ? imagePath
    : `${origin}${imagePath}`

  // Build Netlify Image CDN URL with query parameters using current origin
  const params = new URLSearchParams({
    url: fullImageUrl,
    fit,
    fm: format,
    q: quality.toString(),
  })

  if (width) params.set(`w`, width.toString())
  if (height) params.set(`h`, height.toString())

  return `${origin}/.netlify/images?${params.toString()}`
}
