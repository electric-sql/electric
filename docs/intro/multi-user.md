---
title: Realtime multi-user
sidebar_position: 20
---

import QRCode from 'react-qr-code'

import BrowserOnly from '@docusaurus/BrowserOnly'
import useBaseUrl from '@docusaurus/useBaseUrl'

import RealtimeDemo from '!!raw-loader!@site/intro/src/demos/multi-user/realtime.jsx'
import { getOrCreateSessionId } from '@site/intro/src/session'

As well as being [instantly reactive](./local-first.md), local-first also naturally supports multi-user collaboration. You write data locally and it syncs in the background between users and devices.

:::note
Remember, source code for the widgets in this introduction is in the [examples/introduction](https://github.com/electric-sql/electric/tree/main/examples/introduction) folder of the main [electric&#8209;sql/electric](https://github.com/electric-sql/electric) repo.
:::

## Multi-user

Below, we've again embedded two demo apps. This time, they're both the same local-first app, being used by a different user.

<CodeBlock live={true} noInline={true} language="jsx">{
  RealtimeDemo
}</CodeBlock>

As you can see, if one user interacts with the interface, the changes naturally sync to the other user. If you expand the live editor, you'll see there's no special code involved in making the app multi-user. You just read and write data to the local database and support for realtime collaboration is naturally built in.

## Multi-platform

Sync also works across multiple devices and across web and mobile. For example, you can open the same demo app in your mobile browser<!-- and / or a native app below -->:

<div className="grid grid-cols-1 gap-4 my-6 mb-8">
  <div className="tile">
    <div className="px-3 md:px-4">
      <div className="my-2 sm:my-3 md:my-4 --w-8 --sm:w-9 --md:w-10">
        <div className="flex flex-row">
          <div className="qr-container">
            <BrowserOnly>
              {() => {
                const loc = window.location
                const parts = [loc.origin, loc.pathname, '?sessionId=', getOrCreateSessionId()]
                const url = parts.join('')
                return (
                  <a href={url} target="_blank">
                    <QRCode value={url} />
                  </a>
                )
              }}
            </BrowserOnly>
          </div>
          <div className="ml-8 sm:ml-10 lg:ml-12 -mt-1 sm:-mt-0">
            <a href="/docs/examples/basic">
              <h3>
                Mobile web
              </h3>
              <p className="text-small mb-2 max-w-sm">
                Scan to open the demo app above in your mobile phone's web browser.
              </p>
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
  {/*<div className="tile">
    <div className="px-3 md:px-4">
      <a href="/docs/examples/linear-lite">
        <img src={useBaseUrl('/img/qr/mobile-app.svg')} loading="lazy"
            className="my-2 sm:my-3 md:my-4 w-8 sm:w-9 md:w-10"
        />
        <h3>
          Native app
        </h3>
        <p className="text-small mb-2">
          Scan to open same demo app in a native Expo app.
        </p>
      </a>
    </div>
  </div>*/}
</div>

Scan the QR code and scroll down a touch to see the same multi-user demo app. Also make sure you have the demo in view in this browser. Then have a play with both :) You'll see changes sync in realtime across your devices.

<hr className="doc-divider" />

As we'll see in [active-active replication](./active-active.md), sync isn't limited to web and mobile. Before we dive into that, let's first see how realtime sync and [conflict-free offline](./offline.md) play together &raquo;
