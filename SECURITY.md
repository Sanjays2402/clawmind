# Security policy

For anything sensitive, email the maintainer rather than opening a public issue. Provide a minimal reproduction and the version of ClawMind you are running.

Coordinated disclosure is appreciated. There is no bug bounty.

## What we already do

- Threat model lives in [`docs/threat-model.md`](docs/threat-model.md) and lists assets, adversaries, and controls mapped to STRIDE.
- Per-surface security notes live in [`docs/security.md`](docs/security.md).
- CI runs `gitleaks` on every push and PR with a project-specific ruleset in `.gitleaks.toml`, so committed secrets fail the build before merge.
- CI runs `pnpm audit --audit-level high` so a known-bad dependency blocks the gate.
- `CODEOWNERS` requires the maintainer on every change to auth, sessions, MFA, SSO, API keys, IP allowlists, audit logging, webhooks, lockfiles, and CI config.
- Dependabot opens patch and minor updates daily; safe updates auto-merge on green CI.
