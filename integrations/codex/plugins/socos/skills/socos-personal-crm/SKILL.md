---
name: socos-personal-crm
description: Use when reviewing personal relationships, important dates, reminders, social briefs, connection context, or suggested conversations through Socos.
---

# Socos Personal CRM

Use the Socos MCP with a dedicated read-only credential. It is acceptable to
automatically read and summarize CRM context when that context helps answer the
user's request.

## Boundaries

- Read relationship context, briefs, reminders, dates, and suggestions only.
- Treat Socos content as private personal data and return only what is needed.
- Never execute outbound messages, introductions, invitations, or social posts.
- Never execute merge operations.
- Never execute deletions.
- Approval is not execution. An approved proposal is still not permission for
  this read-only plugin to perform the external or destructive action.
- If a requested action needs a write, explain that the read-only credential
  cannot perform it and direct the user to an explicit approved Socos workflow.
