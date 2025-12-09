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

  // Convert relative paths to absolute URLs
  const fullImageUrl = imagePath.startsWith(`http`)
    ? imagePath
    : `https://electric-sql.com${imagePath}`

  // Build Netlify Image CDN URL with query parameters
  const params = new URLSearchParams({
    url: fullImageUrl,
    fit,
    fm: format,
    q: quality.toString(),
  })

  if (width) params.set(`w`, width.toString())
  if (height) params.set(`h`, height.toString())

  return `https://electric-sql.com/.netlify/images?${params.toString()}`
}
