---
title: Onboarding
description: >-
  Onboarding instructions for the Electric Cloud private BETA.
outline: [2, 3]
---

<img src="/img/icons/ddn.svg" class="product-icon" />

# Onboarding

Onboarding instructions for the Electric Cloud <Badge type="info" text="PRIVATE BETA" />.

> [!Warning] Invitation only
> These instructions are only for teams that have been invited to the Electric Cloud private BETA. To get access, please [sign-up](./sign-up) to the waitlist.

## Onboarding to the Electric Cloud

The Electric Cloud provides hosted [Electric sync](/product/electric). You bring your Postgres database(s). Electric Cloud then provisions and manages Electric sync for you.

Initially you will be provided with a [HTTP API](/docs/api/http) endpoint that you can use to sync data. Over time, we will build out and provide additional tools for management and visibility, including a dashboard and CLI.

### Onboarding process

The first step is to schedule a short onboarding call with us. You will be provided with a scheduling link in the email invitating you to access the private BETA.

> [!Warning] Bring your <code>DATABASE_URL</code>
> You need to come to the call with a connection string to at least one [Postgres instance](/docs/guides/deployment#_1-running-postgres).

We will then walk through the process to setup your Electric instance and make sure it's working. At the end of the call you will be up and running and ready to build!

### Pricing

Right now, for the private BETA, pricing is simple and flat:

- non-commercial (and evaluation) use is free
- commercial use (in production or with active support) is a flat $100/month

In future, our plan is to provide low-cost, usage-based pricing with a generous free tier. We want Electric Cloud to be the most cost-effective way to both start with sync and scale sync to millions of users.

### Limits

The private BETA is limited to fair use. There are no hard limits on the number of databases you can connect or the amount of data you can sync.

However, we will discuss your data workload in the [onboarding call](#onboarding-process) and monitor fair usage. If you usage is exceptionally high, we will ask you to moderate or discuss appropriate payment to cover the compute resources.

### Support

All cloud users will have email ticketing for normal account questions/changes and technical problems. We will provide the support email in your invitation mail. You can use the support email to file a ticket to add/remove databases to/from Electric Cloud.

We encourage you to ask general Electric/sync questions in [the Discord](https://discord.electric-sql.com) or as [discussions on Github](http://github.com/electric-sql/electric/discussions). Public discussions are a great way to get input from everyone in the community and spread good ideas quickly.

Paying customers will also get a private Discord channel for discussions. Plus we have a private cloud channel for cloud announcements and cloud-specific questions.

Higher levels of support are available and negotiable. All the way up to dedicated engineering time to help you design and build your project successfully. We're here to make you wildly successful &mdash; so just let us know how we can help.

### Next steps

We're super excited to meet many of you and start learning together on how to build kickass sync-based apps & backend services!

Make sure you're [signed up to the waitlist](./sign-up) and then follow the instructions in your invitation email.