import ReactDOM from 'react-dom'
// @ts-expect-error jsx files have no type declarations
import LocalFirst from './demos/local-first/instant'
// @ts-expect-error jsx files have no type declarations
import ActiveActive from './demos/active-active/replication'
// @ts-expect-error jsx files have no type declarations
import MultiUser from './demos/multi-user/realtime'
// @ts-expect-error jsx files have no type declarations
import OfflineConnectivity from './demos/offline/connectivity'
// @ts-expect-error jsx files have no type declarations
import OfflineIntegrity from './demos/offline/integrity'

import './index.css'

ReactDOM.render(
  <div>
    <LocalFirst />
    <ActiveActive />
    <MultiUser />
    <OfflineConnectivity />
    <OfflineIntegrity />
  </div>,
  document.getElementById('root'),
)
