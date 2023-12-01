---
title: Checkout
description: A simple online store and checkout example using Supabase Postgres
sidebar_position: 30
---

import QRCode from 'react-qr-code'
import BrowserOnly from '@docusaurus/BrowserOnly'

# Checkout example

This is an example of an online store and checkout built using Electric. You can see it running at [checkout-demo.electric-sql.com](http://checkout-demo.electric-sql.com/)

The full catalogue is synchronised to the local device making all interactions instantaneous, and removing any latency, which would result in increased conversion rates. This design also enables users to browse the store, and place items into their basket, while offline. When the user reconnects, any changes they have made to their basket will be synchronised across any devices where they are logged in.

This demo also uses an [Event Sourcing](../integrations/event-sourcing/) architecture, which enables a local-first checkout experience. Rather than calling an order placement API, orders and their payment details are entered into the database. A trigger is then called when the order is synced into Postgres that subsequently processes the order.

<div className="pb-4">
  <div className="card mt-4">
    <div className="embed-container w-100 max-w-md">
      <iframe src="https://www.youtube.com/embed/WhRBvJ4cUWk"
          frameborder="0"
          allow="encrypted-media; picture-in-picture"
          allowfullscreen>
      </iframe>
    </div>
  </div>
</div>

You can also open it in your mobile browser by scanning this QR code:

<div className="grid grid-cols-1 gap-4 my-6 mb-8 clear-both">
  <div className="tile">
    <div className="px-3 md:px-4">
      <div className="my-2 sm:my-3 md:my-4 --w-8 --sm:w-9 --md:w-10">
        <div className="flex flex-row">
          <div className="qr-container">
            <BrowserOnly>
              {() => (
                <a href="https://checkout-demo.electric-sql.com" target="_blank">
                  <QRCode value="https://checkout-demo.electric-sql.com" />
                </a>
              )}
            </BrowserOnly>
          </div>
          <div className="ml-8 sm:ml-10 lg:ml-12 -mt-1 sm:-mt-0">
            <a href="https://checkout-demo.electric-sql.com">
              <h3>
                Open in mobile browser
              </h3>
              <p className="text-small mb-2 max-w-sm">
                Scan to open the checkout demo app in your mobile phone's web browser.
              </p>
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

## Supabase integration

The example app's UI is built with the [Ionic framework](https://ionicframework.com) and [Supabase's suite of tools](https://supabase.com/), namely, the hosted Postgres database, Supabase Auth, and Edge Functions. Finally, the UI is built with the Ionic framework.

Authentication for the store uses [Supabase Auth](https://supabase.com/docs/guides/auth), using their standard form component, and then uses the same JWT token for authenticating with the Electric sync service.

A [Supabase Edge Function](https://supabase.com/docs/guides/functions) is used to process orders when they are placed. This is a called from an "on insert" trigger on the 'orders table' in Postgres. When an order is placed in the app, it is entered as a row into the local orders table; this is then synchronised with the remote Postgres table by Electric.

For details on how to use Electric with Supabase Postgres, how you can use Supabase Auth as the authentication system for your Electric app, and how to configure Edge Function for Event Sourcing, see <DocPageLink path="integrations/deployment/supabase" />.

## Source code

Clone the monorepo:

```shell
git clone https://github.com/electric-sql/electric
```

Change into the `checkout` example directory:

```shell
cd electric/examples/checkout
```

Follow the instructions in the [README.md](https://github.com/electric-sql/electric/blob/main/examples/checkout/README.md).
