---
"@electric-ax/agents-runtime": patch
"@electric-ax/agents-server-ui": patch
---

Show detailed agent run failure information in the timeline instead of the generic `Run failed` fallback. Run errors now include their error code, failed tool calls preserve and render their error text, and failed runs fall back to tool errors or finish reasons when no run error row is available.
