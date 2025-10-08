<script setup>
import { ref, onMounted, computed } from "vue"

// Props to configure the component
const props = defineProps({
  did: {
    type: String,
    required: true,
  },
  limit: {
    type: Number,
    default: 2,
  },
})

const posts = ref([])
const loading = ref(true)
const error = ref(null)

// Cache implementation
const CACHE_KEY = `bluesky-posts-${props.did}-${props.limit}`
const CACHE_EXPIRY = 60 * 60 * 1000 // 1 hour in milliseconds

// Check if data is in cache and not expired
function getFromCache() {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (cached) {
      const { data, timestamp } = JSON.parse(cached)
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        return data
      }
    }
  } catch (err) {
    console.warn("Cache error:", err)
  }
  return null
}

// Save data to cache
function saveToCache(data) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        data,
        timestamp: Date.now(),
      })
    )
  } catch (err) {
    console.warn("Error saving to cache:", err)
  }
}

// Convert UTF-16 string positions to UTF-8 byte positions
function utf16ToUtf8Indices(str) {
  const result = new Map()
  const utf8Lengths = new Uint8Array(str.length)

  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    // Calculate UTF-8 byte length for each character
    utf8Lengths[i] =
      code < 0x80
        ? 1
        : code < 0x800
          ? 2
          : code < 0xd800 || code >= 0xe000
            ? 3
            : 4

    // Skip the second part of surrogate pairs
    if (code >= 0xd800 && code < 0xdc00 && i + 1 < str.length) {
      utf8Lengths[i + 1] = 0
      i++
    }
  }

  let utf8Pos = 0
  for (let i = 0; i < str.length; i++) {
    result.set(utf8Pos, i)
    utf8Pos += utf8Lengths[i]
  }

  return result
}

// Render the Bluesky post with proper formatting
function renderPost(text, facets) {
  if (!text || !facets || !Array.isArray(facets)) {
    return text || ""
  }

  // Create segments for easier manipulation
  const segments = [
    {
      text,
      link: null,
    },
  ]

  // Map from UTF-8 byte positions to UTF-16 string indices
  const indexMap = utf16ToUtf8Indices(text)

  // Sort facets by start position (in descending order to avoid offset shifts)
  const sortedFacets = [...facets].sort(
    (a, b) => b.index.byteStart - a.index.byteStart
  )

  // Process each facet
  for (const facet of sortedFacets) {
    if (!facet.index?.byteStart || !facet.index?.byteEnd) continue

    // Find the closest UTF-16 positions
    const startUtf16 = indexMap.get(facet.index.byteStart) || 0
    const endUtf16 = indexMap.get(facet.index.byteEnd) || text.length

    // Find which segment contains this range
    let segmentIndex = -1
    let segmentStart = 0

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const segmentEnd = segmentStart + segment.text.length

      if (
        segmentStart <= startUtf16 &&
        endUtf16 <= segmentEnd &&
        !segment.link
      ) {
        segmentIndex = i
        break
      }

      segmentStart = segmentEnd
    }

    if (segmentIndex === -1) continue

    const segment = segments[segmentIndex]
    const relativeStart = startUtf16 - segmentStart
    const relativeEnd = endUtf16 - segmentStart

    // Skip if positions are invalid
    if (
      relativeStart < 0 ||
      relativeEnd > segment.text.length ||
      relativeStart >= relativeEnd
    ) {
      continue
    }

    // Get link information from facet
    let linkInfo = null
    if (facet.features && Array.isArray(facet.features)) {
      for (const feature of facet.features) {
        if (feature.$type === "app.bsky.richtext.facet#link" && feature.uri) {
          linkInfo = { type: "link", href: feature.uri }
          break
        } else if (
          feature.$type === "app.bsky.richtext.facet#mention" &&
          feature.did
        ) {
          linkInfo = {
            type: "mention",
            href: `https://bsky.app/profile/${feature.did}`,
          }
          break
        } else if (
          feature.$type === "app.bsky.richtext.facet#tag" &&
          feature.tag
        ) {
          linkInfo = {
            type: "tag",
            href: `https://bsky.app/search?q=${encodeURIComponent(feature.tag)}`,
          }
          break
        }
      }
    }

    if (!linkInfo) continue

    // Split this segment into three parts: before, link, after
    const before = segment.text.substring(0, relativeStart)
    const linkText = segment.text.substring(relativeStart, relativeEnd)
    const after = segment.text.substring(relativeEnd)

    const newSegments = []

    if (before) newSegments.push({ text: before, link: null })
    newSegments.push({ text: linkText, link: linkInfo })
    if (after) newSegments.push({ text: after, link: null })

    // Replace the current segment with our new segments
    segments.splice(segmentIndex, 1, ...newSegments)
  }

  // Now render the segments to HTML
  return segments
    .map((segment) => {
      if (segment.link) {
        return `<a href="${segment.link.href}" target="_blank" rel="noopener noreferrer" class="post-${segment.link.type}">${segment.text}</a>`
      }
      return segment.text
    })
    .join("")
}

// Format the date for display (e.g., "Mar 7, 2025")
function formatDisplayDate(timestamp) {
  const date = new Date(timestamp)
  const month = date.toLocaleString("en-US", { month: "short" })
  const day = date.getDate()
  const year = date.getFullYear()

  return `${month} ${day}, ${year}`
}

// Get post author
const getPostAuthor = (post) => post.post.author

// Get post time
const getPostTime = (post) => post.post.indexedAt || post.post.record?.createdAt

// Process posts to handle facets and other formatting
const processedPosts = computed(() => {
  return posts.value.map((post) => ({
    ...post,
    processedText: renderPost(
      post.post.record?.text || "",
      post.post.record?.facets || []
    ),
  }))
})

// Fetch posts from Bluesky Public API
async function fetchPosts() {
  loading.value = true
  error.value = null

  // Check cache first
  const cachedData = getFromCache()
  if (cachedData) {
    posts.value = cachedData
    loading.value = false
    return
  }

  try {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${props.did}&limit=${props.limit}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`Failed to fetch posts: ${response.statusText}`)
    }

    const data = await response.json()
    posts.value = data.feed
    saveToCache(data.feed)
  } catch (err) {
    console.error("Error fetching Bluesky posts:", err)
    error.value = err.message
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchPosts()
})
</script>

<template>
  <div class="bluesky-posts">
    <div v-if="loading" class="loading">Loading posts...</div>

    <div v-else-if="error" class="error">Error: {{ error }}</div>

    <div v-else-if="posts.length === 0" class="no-posts">No posts found.</div>

    <div v-else class="posts-grid">
      <div v-for="post in processedPosts" :key="post.post.uri" class="post">
        <div class="post-header">
          <a
            :href="`https://bsky.app/profile/${getPostAuthor(post).handle}`"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              v-if="getPostAuthor(post).avatar"
              :src="getPostAuthor(post).avatar"
              class="avatar"
              alt="Profile avatar"
            />
          </a>
          <div class="user-info">
            <a
              :href="`https://bsky.app/profile/${getPostAuthor(post).handle}`"
              target="_blank"
              rel="noopener noreferrer"
              class="profile-link"
            >
              <div class="display-name">
                {{ getPostAuthor(post).displayName }}
              </div>
              <div class="handle">@{{ getPostAuthor(post).handle }}</div>
            </a>
          </div>
          <div class="post-date">
            {{ formatDisplayDate(getPostTime(post)) }}
          </div>
        </div>

        <div class="post-content" v-html="post.processedText"></div>

        <div class="post-footer">
          <a
            :href="`https://bsky.app/profile/${getPostAuthor(post).handle}/post/${post.post.uri.split('/').pop()}`"
            target="_blank"
            rel="noopener noreferrer"
            class="view-on-bluesky"
          >
            View on Bluesky →
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bluesky-posts {
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
  max-width: 100%;
}

.loading,
.error,
.no-posts {
  padding: 1rem;
  text-align: center;
  color: #666;
}

.error {
  color: #e53935;
}

.posts-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  margin: 36px 0px;
}

@media (max-width: 749px) {
  .posts-grid {
    grid-template-columns: 1fr;
    margin: 32px 0px;
  }
}

.post {
  border: 1px solid rgba(42, 44, 52, 0.5);
  border-radius: 12px;
  padding: 1rem;
  background: #202127;
  color: #fff;
}

.post-header {
  display: flex;
  align-items: flex-start;
  margin-bottom: 0.75rem;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  margin-right: 12px;
  object-fit: cover;
  transition: opacity 0.2s;
}

.avatar:hover {
  opacity: 0.9;
}

.user-info {
  flex-grow: 1;
  line-height: 1.2;
}

.display-name {
  font-weight: bold;
  font-size: 0.9rem;
  margin-bottom: 1px;
}

.display-name:hover {
  text-decoration: underline;
}

.handle {
  color: #9ca3af;
  font-size: 0.8rem;
}

.handle:hover {
  text-decoration: underline;
}

.post-date {
  color: #9ca3af;
  font-size: 0.8rem;
  padding-top: 2px;
}

.post-content {
  margin-bottom: 0.75rem;
  white-space: pre-wrap;
  line-height: 1.4;
  font-size: 0.92rem;
  overflow-wrap: break-word;
  word-break: break-word;
  color: var(--vp-c-text-2);
}

/* Let the site stylesheet apply hyperlink color */
.post-content :deep(a),
.profile-link {
  text-decoration: none;
  white-space: nowrap;
}

.post-content :deep(a:hover) {
  text-decoration: underline;
}

.post-footer {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid #2a2c34;
  padding-top: 0.75rem;
  margin-top: 0.5rem;
}

.view-on-bluesky {
  font-size: 0.8rem;
  text-decoration: none;
}

.view-on-bluesky:hover {
  text-decoration: underline;
}
</style>
