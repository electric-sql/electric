import { tunnel, defaultOptions, type TunnelOptions } from './tunnel'

/**
 * Handles calls to `npx electric-sql proxy-tunnel`, this opens a tunnel to the Electric
 * Postgres Proxy and binds it to a local port.
 * The proxy-tunnel command supports the following arguments:
 *  - `--service <url>`
 *     Optional argument providing the url to connect to Electric.
 *     If not provided, it uses the url set in the `ELECTRIC_URL`
 *     environment variable. If that variable is not set, it
 *     resorts to the default url which is `http://localhost:5133`.
 * - `--local-port <url>`
 *    Optional argument providing the local port to bind the tunnel to.
 * @param args Arguments passed to the proxy-tunnel command.
 */
export async function handleTunnel(...args: string[]) {
  // merge default options with the provided arguments
  const opts: TunnelOptions = {
    ...defaultOptions,
    ...parseTunnelArgs(args),
  }

  tunnel(opts)
}

/**
 * Parses the arguments passed to the proxy-tunnel command.
 * @param args Arguments passed to the proxy-tunnel command.
 * @returns The parsed arguments.
 */
function parseTunnelArgs(args: string[]) {
  if (args.length % 2 !== 0 || args.length > 4) {
    throw new Error('Invalid number of arguments')
  }

  const opts: Partial<TunnelOptions> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '--service':
        opts.serviceUrl = args[++i]
        break
      case '--local-port':
        opts.localPort = parseInt(args[++i])
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  // prepend protocol if not provided in service url
  const serviceUrl = opts.serviceUrl?.trim()
  if (serviceUrl && !/^(http|ws)s?:\/\//.test(serviceUrl)) {
    opts.serviceUrl = 'ws://' + serviceUrl
  }

  return opts
}
