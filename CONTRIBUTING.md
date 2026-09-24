# Contributing to RAPID

Thanks for your interest in contributing. Issues, feature requests and pull requests are all welcome. Please read this document before you open one, so your contribution can be reviewed and merged with as little back-and-forth as possible.

RAPID is a prototyping blueprint, not production software. Contributions that keep it simple, fast to deploy and easy to read are preferred over contributions that add production hardening, abstraction layers or configuration surface. See [AGENTS.md](AGENTS.md) for the conventions the repository follows.

## Reporting bugs and requesting features

Use the GitHub Issues tab of this repository for both. Before opening a new issue, please:

- Search open and recently closed issues to check that it has not already been reported.
- Confirm you are on the latest `main`.

A useful bug report includes:

- A reproducible test case or series of steps, starting from a clean clone.
- The version of the repository you are using (commit SHA).
- Your environment: operating system, host architecture, Node.js version, Python version, AWS region.
- The relevant `config.yaml` values, with account IDs and domain names redacted.
- What you expected to happen, what happened instead, and the log output that shows it.

Do **not** open a public issue for a security vulnerability. See [Security issues](#security-issues) below.

## Contributing via pull requests

Before you invest significant time, open an issue to discuss the change. That avoids the case where a large pull request is declined because it takes the project in a direction the maintainers do not want to go.

To send us a pull request:

1. Fork the repository.
2. Create a branch from `main`. Do not work on `main` directly.
3. Make your change. Keep the change focused on one concern — a pull request that fixes a bug and reformats three unrelated files is hard to review.
4. Update the documentation that your change affects. Every fact in this repository has exactly one authoritative file; change it there rather than adding a second copy.
5. Run the local verification commands below and make sure they pass.
6. Commit using clear, descriptive messages.
7. Open the pull request against `main`, filling in the pull-request template. State what you verified.
8. Respond to review feedback and to any automated check that fails.

GitHub's [forking a repository](https://help.github.com/articles/fork-a-repo/) and [creating a pull request](https://help.github.com/articles/creating-a-pull-request/) guides cover the mechanics.

### Local verification

Run this from the repository root before you open a pull request. The same check runs on every pull request in CI, so running it locally is the fastest way to get a green build.

```bash
# Infrastructure: template synthesis and CDK unit tests
cd infra && npx cdk synth && npm test
```

If your change touches an agent, an MCP server or the frontend, also exercise it locally — see [GETTING_STARTED.md](GETTING_STARTED.md) for the local development loop.

## Code of conduct

This project has adopted a code of conduct. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). By participating, you are expected to uphold it.

## Security issues

If you discover a potential security issue, please report it through the [AWS vulnerability reporting page](https://aws.amazon.com/security/vulnerability-reporting/). Do not create a public GitHub issue.

## Licensing

This project is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

By submitting a contribution, you agree that your contribution is licensed under the Apache License, Version 2.0, and you confirm that you have the right to submit it under those terms. We may ask you to confirm the licensing of your contribution on larger changes.
