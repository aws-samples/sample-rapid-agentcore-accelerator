---
name: Bug report
about: Report something that does not work as documented
title: ''
labels: bug
assignees: ''
---

Before you file: please search open and recently closed issues, and confirm you
are on the latest `main`. If you have found a potential security vulnerability,
do **not** open a public issue — report it through the
[AWS vulnerability reporting page](https://aws.amazon.com/security/vulnerability-reporting/)
instead.

## Description

A clear description of what is broken.

## Steps to reproduce

Starting from a clean clone, the shortest sequence that reproduces the problem.

1.
2.
3.

## Expected behaviour

What you expected to happen, and where the repository documents that behaviour.

## Actual behaviour

What happened instead.

## Environment

- Commit SHA (`git rev-parse HEAD`):
- Operating system and version:
- Host architecture (`uname -m`):
- Node.js version (`node --version`):
- Python version (`python3 --version`):
- AWS region:

## Relevant `config.yaml` values

Redact AWS account IDs and any real domain names.

```yaml
# paste the relevant keys only
```

## Log output

Include the failing command and its output. For a deployed agent, `make logs`
tails the runtime logs; [docs/troubleshooting.md](../../docs/troubleshooting.md)
names the log source for each documented failure mode.

```text
paste log output here
```

## Anything else

Screenshots, related issues, or a workaround you found.
