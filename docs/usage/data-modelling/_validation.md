---
title: Validation
description: >-
  How to validate user input (not currently supported).
sidebar_position: 60
---

:::caution Limitations
User input validation is not currently supported. See <DocPageLink path="reference/limitations" /> for context.
:::

## Notes

Validation rules will be defined database side [using DDLX](../../api/ddlx.md). Logic will then be compiled to run both in the [Client](../data-access/client.md) and as part of the write authorisation step on the server.
