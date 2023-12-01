---
title: Checkout
description: A online store and checkout example using Electric with Supabase and Ionic
sidebar_position: 30
---

import QRCode from 'react-qr-code'
import BrowserOnly from '@docusaurus/BrowserOnly'

# Checkout example

This is an example of an online store and checkout app. It is built using Electric with [Supabase](#supabase-integration) and the [Ionic framework](https://ionicframework.com).

You can see it running at [checkout-demo.electric-sql.com](http://checkout-demo.electric-sql.com/) and in the demo screencast below:

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

## How the example works

The example app shows a simplified checkout flow for an e-commerce store. It starts with an auth screen. Once logged in, you can add products to a shopping basket. You can then checkout, entering your order and delivery details. There is then a step to place your order and wait for server confirmation that (in this case mock) payment has gone through and the order is confirmed.

The product catalogue is synchronised to the local device. This takes the network off the interaction path in the ordering flow. These is a direct relationship in e-commerce between latency and conversion rates. So this demonstrates a checkout flow that can maximum conversion. It also works offline, all the way up until order confirmation, which uses an [event sourcing](../integrations/event-sourcing/) pattern to have server confirmation of the order.

Rather than calling an out-of-band order placement API, orders and their payment details are written to the local database. When the data syncs to the server, a Postgres database trigger calls a Supabase edge function. This processes the order and is a place where you can take payment, initiate fulfillment, etc. When finished processing, the edge function updates the order status column. This syncs back to the client and the client interface shows the order as confirmed.

This pattern allows a zero-barrier, local-first, offline-capable checkout flow to work with server-side confirmation and secure payment transactions.

## Supabase integration

The example app uses [Supabase](https://supabase.com) for [auth](https://supabase.com/docs/guides/auth), [edge functions](https://supabase.com/docs/guides/functions) and to host the Postgres database.

Authentication for the store uses [Supabase Auth](https://supabase.com/docs/guides/auth), using their standard form component. It then uses JWT token provided by Supabase to authenticate the connection to the Electric sync service. This works by configuring the same private key to verify the token with both Supabase and Electric and because both services support reading the user ID from the `sub` claim of the JWT.

A [Supabase Edge Function](https://supabase.com/docs/guides/functions) is used to process orders when they are placed. This is a called from an "on insert" trigger on the `orders` in Postgres.

For more details on how to use Electric with Supabase Postgres, see <DocPageLink path="integrations/deployment/supabase" />.

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
