export type ModelProviderErrorCode =
  | `MODEL_PROVIDER_TIMEOUT`
  | `MODEL_PROVIDER_UNREACHABLE`
  | `MODEL_PROVIDER_AUTH_FAILED`
  | `MODEL_PROVIDER_RATE_LIMITED`
  | `MODEL_PROVIDER_UNAVAILABLE`
  | `MODEL_PROVIDER_ERROR`

export class ModelProviderError extends Error {
  readonly code: ModelProviderErrorCode
  readonly provider?: string
  readonly model?: string

  constructor(opts: {
    code: ModelProviderErrorCode
    message: string
    provider?: string
    model?: string
    cause?: unknown
  }) {
    super(
      opts.message,
      opts.cause === undefined ? undefined : { cause: opts.cause }
    )
    this.name = `ModelProviderError`
    this.code = opts.code
    this.provider = opts.provider
    this.model = opts.model
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause
    return [
      error.name,
      error.message,
      cause === undefined ? `` : stringifyError(cause),
    ]
      .filter(Boolean)
      .join(` `)
  }
  return String(error)
}

export function classifyModelProviderError(
  error: unknown
): ModelProviderErrorCode {
  const text = stringifyError(error).toLowerCase()

  if (
    /\b(aborterror|timeouterror)\b/.test(text) ||
    text.includes(`timeout`) ||
    text.includes(`timed out`)
  ) {
    return `MODEL_PROVIDER_TIMEOUT`
  }

  if (
    text.includes(`401`) ||
    text.includes(`invalid api key`) ||
    text.includes(`authentication`) ||
    text.includes(`unauthorized`)
  ) {
    return `MODEL_PROVIDER_AUTH_FAILED`
  }

  if (text.includes(`429`) || text.includes(`rate limit`)) {
    return `MODEL_PROVIDER_RATE_LIMITED`
  }

  if (
    text.includes(`502`) ||
    text.includes(`503`) ||
    text.includes(`504`) ||
    text.includes(`overloaded`) ||
    text.includes(`unavailable`)
  ) {
    return `MODEL_PROVIDER_UNAVAILABLE`
  }

  if (
    text.includes(`enotfound`) ||
    text.includes(`econnrefused`) ||
    text.includes(`econnreset`) ||
    text.includes(`eai_again`) ||
    text.includes(`fetch failed`) ||
    text.includes(`failed to fetch`) ||
    text.includes(`network`)
  ) {
    return `MODEL_PROVIDER_UNREACHABLE`
  }

  return `MODEL_PROVIDER_ERROR`
}

export function modelProviderErrorMessage(opts: {
  code: ModelProviderErrorCode
  provider?: string
}): string {
  const provider = opts.provider
    ? displayProvider(opts.provider)
    : `the model provider`
  switch (opts.code) {
    case `MODEL_PROVIDER_TIMEOUT`:
      return `${provider} did not respond before the timeout. Check your Internet connection or provider status.`
    case `MODEL_PROVIDER_UNREACHABLE`:
      return `Could not reach ${provider}. Check your Internet connection or ${provider} status.`
    case `MODEL_PROVIDER_AUTH_FAILED`:
      return `${provider} rejected the API key. Check your model provider credentials.`
    case `MODEL_PROVIDER_RATE_LIMITED`:
      return `${provider} rate limited the request. Please wait and try again.`
    case `MODEL_PROVIDER_UNAVAILABLE`:
      return `${provider} is currently unavailable. Check provider status and try again.`
    case `MODEL_PROVIDER_ERROR`:
      return `${provider} returned an error. Check the runtime logs for provider details.`
  }
}

export function toModelProviderError(
  error: unknown,
  opts: { provider?: string; model?: string }
): ModelProviderError {
  if (error instanceof ModelProviderError) return error
  const code = classifyModelProviderError(error)
  const detail = error instanceof Error ? error.message : String(error)
  return new ModelProviderError({
    code,
    provider: opts.provider,
    model: opts.model,
    message: `${modelProviderErrorMessage({ code, provider: opts.provider })} (${detail})`,
    cause: error,
  })
}

function displayProvider(provider: string): string {
  switch (provider.toLowerCase()) {
    case `anthropic`:
      return `Anthropic`
    case `openai`:
      return `OpenAI`
    default:
      return provider
  }
}
