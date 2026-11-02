# Agents

One Markdown file per agent role (`<name>.agent.md`), loaded by the server's `AgentRunner` (Phase 2).

- **Frontmatter:** `name`, `description`, `model`, `effort`, `skills`, `tools` (read-only), `output` (zod schema name), `max_tool_calls`.
- **Body:** the system prompt.

Planned roles: elicitation, requirements-analyst, impact-analyst, estimator, risk-analyst, value-analyst, pm-writer, presenter, backlog-builder, notification-composer.
