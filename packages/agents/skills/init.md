---
description: Scaffold a new Electric Agents app project and get oriented in the codebase
whenToUse: User wants to create a new app, start a project, or scaffold an Electric Agents application
keywords:
  - init
  - scaffold
  - new project
  - create app
  - starter
  - setup
user-invocable: true
argument-hint: '[project-name]'
arguments:
  - project_name
max: 15000
---

# Init: Create a New Electric Agents App

Help the user scaffold and understand a new Electric Agents project.

## Flow

### 1. Assess experience

Before scaffolding, ask the user:

> "Are you familiar with Electric Agents concepts (entities, handlers, spawning workers)? If not, I can walk you through a hands-on quickstart first — or we can dive straight into setting up your project."

- If they want the quickstart → load the quickstart skill with `use_skill("quickstart")`
- If they want to dive in → continue to step 2

### 2. Scaffold the project

**Ask the user where they want the project.** Suggest a sensible default (e.g., `./$project_name` relative to the working directory) but let them choose. Do not create files or directories until the user confirms the location.

If `$project_name` is not provided, ask the user what they'd like to name their project.

Run the init command to create the project:

```
npx electric-ax agents init $project_name
```

After the command completes, read the generated project structure to orient yourself.

### 3. Orient the user

Walk through what was created. Read the key files and explain:

- **Project structure** — what each directory and file is for
- **Entity definitions** — where entity types are defined (e.g., `src/server/` or `entities/`)
- **Server setup** — how the HTTP server and webhook handler work
- **Frontend** — how the UI connects to the agent backend (if applicable)
- **Running it** — the commands to start the dev server

Keep explanations concise. The user can ask follow-up questions.

### 4. Customize

Ask the user what they want to build:

> "What kind of app are you thinking of building? I can help you customize the starter — rename entity types, add new ones, adjust the tools, or modify the UI."

Help them make their first changes to the scaffolded project.

## Rules

- Always read generated files before explaining them — don't assume the scaffold output.
- If the init command doesn't exist or fails, fall back to manual scaffolding: create the project directory, set up package.json, install dependencies, and create a basic server.ts using the pattern from the quickstart skill's scaffold directory.
- Don't overwhelm with information. Give a high-level overview first, then go deeper when asked.
