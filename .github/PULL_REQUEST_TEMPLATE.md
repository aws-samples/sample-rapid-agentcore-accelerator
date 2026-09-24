## What this changes

One or two sentences on what the pull request does and why. Link the issue it
addresses.

Fixes #

## What I verified

**Required.** State what you ran and what the result was. "Looks fine" is not a
verification. Replace the bracketed text with the actual outcome.

- [ ] `cd infra && npx cdk synth && npm test` — result:
- [ ] Anything else you exercised (a local agent conversation, a deploy into your
      own account, an MCP server call) — what you ran and what you observed:

If a command was not applicable to this change, say so and say why rather than
leaving the box unchecked without explanation.

## Documentation

Every fact in this repository has exactly one authoritative file.

- [ ] I updated the authoritative file for each fact this change affects, or this
      change affects none.
- [ ] I did not add a second copy of anything already documented elsewhere.

## Checklist

- [ ] The change is focused on one concern.
- [ ] I read [CONTRIBUTING.md](../CONTRIBUTING.md).
- [ ] I agree that my contribution is licensed under the Apache License,
      Version 2.0, and I confirm I have the right to submit it under those terms.
- [ ] No AWS account IDs, credentials, internal URLs or personal paths appear in
      the diff.
