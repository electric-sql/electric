---
title: How to use
description: Instructions for using Electric recipes
sidebar_position: 10
---

If you're new to ElectricSQL, make sure to follow the [quickstart guide](../quickstart/index.md) to get set up and familiarize yourself with the basic concepts.

The recipes are bite-sized solutions designed to address common challenges in application development using a local-first approach. Each one will provide the following core components:

- Minimum viable database schema to cover the pattern's needs with information on how to extend it.
- Headless component to read and interact with the data in a way that is idiomatic to the specific pattern.
- Usage examples of implementing the pattern with the above headless component and the UI library of your choice.

#### Schema

For the sake of keeping the recipes simple, functional, and extensible, the schemas provided will not assume anything about the structure of your existing application.

This means that you can easily integrate them into your existing application's database schema through e.g. turning some columns into foreign keys to your users table for managing access permissions, or simply adding new columns to store additional data.

#### Headless component

The data access and interaction component will assume that it is being used within the context of an existing Electric client (see the [React integration guide](./integrations/frontend/react) for an example), and that the relevant data is already synced and available through the use of an appropriate [shape subscription](./usage/data-access/shapes).

#### Usage examples

To avoid tying these recipes to any particular UI paradigm, the examples will use generic view components to illustrate how to expose the relevant data and interact with it, and will not assume any particular UI library.

Feel free to replace those with your custom UI implementation or any library of your choosing (e.g. [shad/cn](https://ui.shadcn.com/), [MaterialUI](https://mui.com/material-ui/)).