---
outline: deep
---

# Shapes

Shapes are the core primitive for controlling sync in the ElectricSQL system.

Local apps establish shape subscriptions. This syncs data over the [http](/docs/api/http) API from the Electric server onto the local device.

The Electric sync service maintains shape subscriptions and streams any new data and data changes onto the local device. In this way, local devices can sync a sub-set of a larger database for interactive local use.

Local apps ask the server for a specific set of related data that gets synced to the device. The central Postgres instance will often have too much data to fit on any one device, so shapes allow us to sync only a required subset of data onto the device. There is a balance between local data availability and storage usage on the device that is unique to every application, and shapes allow you to balance those properties while maintaining required guarantees.
