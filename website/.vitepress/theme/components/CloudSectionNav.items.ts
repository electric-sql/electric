export type CloudPill = {
  id: string
  label: string
  href: string
  external?: boolean
  match?: (path: string) => boolean
}

export const CLOUD_PILLS: CloudPill[] = [
  {
    id: `overview`,
    label: `Overview`,
    href: `/cloud`,
    match: (p) => p === `/cloud` || p === `/cloud/`,
  },
  {
    id: `usage`,
    label: `Usage`,
    href: `/cloud/usage`,
    match: (p) => p.startsWith(`/cloud/usage`),
  },
  {
    id: `cli`,
    label: `CLI`,
    href: `/cloud/cli`,
    match: (p) => p.startsWith(`/cloud/cli`),
  },
  {
    id: `pricing`,
    label: `Pricing`,
    href: `/pricing`,
    match: (p) => p.startsWith(`/pricing`),
  },
  {
    id: `dashboard`,
    label: `Dashboard`,
    href: `https://dashboard.electric-sql.cloud`,
    external: true,
  },
]
