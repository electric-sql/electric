/**
 * Check if a URL is absolute (starts with http://, https://, or //)
 */
export function isAbsoluteUrl(url: string): boolean {
  return /^(https?:)?\/\//.test(url)
}

/**
 * Build the full image URL for meta tags.
 * If the image path is already an absolute URL, use it directly.
 * Otherwise, prefix it with the site origin.
 */
export function buildFullImageUrl(
  imagePath: string,
  siteOrigin: string
): string {
  return isAbsoluteUrl(imagePath) ? imagePath : `${siteOrigin}${imagePath}`
}

/**
 * Build the Netlify image proxy URL for optimized meta images.
 * Applies encoding and image transformation parameters.
 */
export function buildMetaImageUrl(
  imagePath: string,
  siteOrigin: string
): string {
  const fullImageUrl = buildFullImageUrl(imagePath, siteOrigin)
  return `${siteOrigin}/.netlify/images?url=${encodeURIComponent(fullImageUrl)}&w=1200&h=630&fit=cover&fm=jpg&q=80`
}
