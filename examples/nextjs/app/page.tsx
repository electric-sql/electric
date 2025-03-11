import dynamic from 'next/dynamic'
import "./Example.css"

// Dynamic import of ItemsList with SSR disabled
const ClientItemsList = dynamic(
  () => import('./items-list').then(mod => mod.ItemsList),
  {
    ssr: false,
  }
)

export default function Page() {
  return <ClientItemsList />
}
