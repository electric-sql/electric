---
title: LLMs - Guide
description: >-
  How to use Electric with LLMs.
outline: [2, 4]
---

<img src="/img/icons/llms.svg" class="product-icon"
    style="width: 72px"
/>

# LLMs

How to use Electric with LLMs like [ChatGPT](https://chatgpt.com) and [Claude](https://claude.ai) and AI code editors like
<span class="no-wrap-lg">
  [Cursor](https://www.cursor.com)
  and
  [Windsurf](https://windsurf.com)</span>.

## Using Electric with LLMs

LLMs are aware of Electric and can generate Electric code. However, LLMs have training data cut-off dates and may not be up-to-date with the latest APIs or capabilities of Electric. As a result, they may generate invalid code.

You can fix this [using our llms.txt](#llms-txt). This works equally well for new projects and for [incremental adoption](#incremental-adoption) / migration of existing projects.

### llms.txt

Electric provides an llms.txt at [https://electric-sql.com/llms.txt](https://electric-sql.com/llms.txt). This contains instructions for LLMs, formatted in a way they can easily digest.

You can use this file in two ways:

1. paste it into your chat window
2. upload it as a file into your project

#### Example - ChatGPT

Manually download the Electric [llms.txt](https://electric-sql.com) file to your computer. Then in ChatGPT use the `Attach` or `+` button to upload the file from your computer:

<figure>
  <img src="/img/guides/llms/chatgpt-upload.jpg" style="border-radius: 16px" />
</figure>

This will upload the file and provide the information in it as context to the LLM. You can then [prompt the LLM](#prompting) to use Electric.

<figure>
  <img src="/img/guides/llms/chatgpt-document-attached.jpg" style="border-radius: 16px" />
</figure>

#### Example - Claude

Similarly if you're using [Claude](https://claude.ai) you can either just upload the file:

<figure>
  <img src="/img/guides/llms/claude-upload.png" style="border-radius: 16px" />
</figure>

Or, more powerfully, you can [create a project](https://www.anthropic.com/news/projects) and add the llms.txt file to the project context. This means that the instructions within it will be applied to all of the chat sessions you create within the project.

<figure>
  <img src="/img/guides/llms/claude-project-context.png" style="border-radius: 16px" />
</figure>

### Prompting

Prompts are how you tell the LLM what you would like to do. You don't need any special prompts to tell the LLM to use Electric. You can just tell it directly, for example:

> Generate a todo-list application using Electric

With the [llms.txt as context](#llms-txt), this will be enough to generate a fully working Electric application. For example, this is Claude's response:

<figure>
  <img src="/img/guides/llms/claude-electric-project.jpg" />
</figure>

The rule-of-thumb with prompting is that you need to provide all of the information to the LLM that it doesn't have in its training set (or project context). So, for example, if you want to use a specific database host like Supabase or Neon, you should say that. Or if you want to use a [specific pattern for writes](/docs/guides/writes) you should say that, e.g.:

> Generate a todo-list application using Electric with the shared persistent pattern for optimistic writes, with Valtio as the client side store. Use hard deletes and UUIDs as primary keys. Make the data model Users -> Workspaces -> Lists -> Todos -> Comments. Allow todos to be assigned to users. Allow users to comment on todos.

It's also often productive to ask the LLM to write out an implementation plan and then implement in steps.

> Do not implement the code yet. First take your time to consider the best implementation approach. Then carefully write out a high level implementation plan. Make sure to consider code quality, maintainability, UX and performance. Break down the implementation into steps which will yield working, testable code.

You can then review the plan, if necessary correct / fine-tune it and then tell the LLM to implement one step at a time. Ideally you can then ask the LLM to write tests so you can verify that the code works at each step along the way.

### Incremental adoption

Because Electric [works with your existing stack](/blog/2024/11/21/local-first-with-your-existing-api), it's great for incrementally migrating an existing app to use sync. Because it works with [any standard Postgres](/docs/guides/deployment#_1-running-postgres), it's also very good for evolving LLM generated projects which have chosen Postgres (or a specific Postgres host like Supabase or Neon) as their default database and/or state transfer technology.

For these, you can provide the existing code as context, for example by adding a local code folder to Cursor or Windsurf.

#### Example - Windsurf

Here we've added the local clone of the [electric-ai-chat demo app](/demos/ai-chat) to [Windsurf](https://windsurf.com), by selecting the folder from our local filesystem.

<figure>
  <img src="/img/guides/llms/windsurf-local-folder.jpg" />
</figure>

You can then identify existing components or routes that are fetching data and tell the LLM to replace the data wiring with Electric sync. This can typically be achieved by selecting the relevant code and then prompting to revise it.

#### Example - Cursor

For example in [Cursor](https://cursor.com), you can navigate to the file, select any relevant code and then prompt to tell the LLM how you'd like to change it:

<figure>
  <img src="/img/guides/llms/cursor-local-editing.jpg" />
</figure>

## More information

See the [llms.txt website](https://llmstxt.org) and this [prompting guide](https://www.promptingguide.ai/applications/coding) for more information.

You may also be interested to read our [Untangling the LLM Spaghetti](/blog/2025/04/22/untangling-llm-spaghetti) and [Building&nbsp;AI&nbsp;apps? You&nbsp;need&nbsp;sync](/blog/2025/04/09/building-ai-apps-on-sync) posts:

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
        href="/blog/2025/04/09/building-ai-apps-on-sync"
        text="Building AI apps"
        theme="brand"
    />
    &nbsp;
    <VPButton
        href="/blog/2025/04/22/untangling-llm-spaghetti"
        text="Untangling LLM Spaghetti"
        theme="alt"
    />
  </div>
</div>
