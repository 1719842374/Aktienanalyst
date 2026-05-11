# Security Policy

## Supported Versions

Only the `main` branch is actively maintained. Older commits or forks are not covered by this policy.

| Branch  | Supported |
| ------- | --------- |
| `main`  | ✅ Yes    |
| Other   | ❌ No     |

---

## Reporting a Vulnerability

If you discover a security issue, **do not open a public GitHub issue**. Instead, report it privately so we can fix it before disclosure.

### Preferred channel

- **Email:** philip.diaz.rohr@gmail.com
- **Subject line:** `[SECURITY] Stock Analyst Pro — <short summary>`

### Alternative

- **GitHub Security Advisory:** [Open a draft advisory](https://github.com/1719842374/Aktienanalyst/security/advisories/new) (private, only visible to maintainers until published)

### What to include

1. **Summary** of the vulnerability (1–2 sentences)
2. **Affected component** — file path, endpoint, or feature
3. **Reproduction steps** — minimal proof-of-concept
4. **Impact** — confidentiality / integrity / availability, severity estimate
5. **Suggested fix** if you have one

---

## What we consider in-scope

- API key leaks via logs, error messages, or git history
- Authentication / authorization bypass on any `/api/*` endpoint
- Server-Side Request Forgery (SSRF) via the FMP / OpenRouter wrappers
- Denial-of-Service vectors (unbounded cache writes, infinite LLM loops, etc.)
- XSS in user-rendered content (ticker names, news titles, LLM output)
- Cache poisoning that affects multiple users
- Dependency vulnerabilities (npm audit critical/high)

## What we consider out-of-scope

- Issues requiring physical access to the deployment host
- Vulnerabilities in unsupported browsers (anything older than Chrome 100, Safari 15, Firefox 100)
- Self-XSS or social-engineering attacks on individual users
- Rate-limiting on public endpoints (we rely on upstream FMP / OpenRouter quotas)
- Financial accuracy disputes — those belong in the bug tracker, not security

---

## Disclosure Timeline

| Day  | Action |
| ---- | ------ |
| 0    | Vulnerability received, acknowledgement sent within 48 hours |
| 1–7  | Initial triage + severity assessment |
| 7–30 | Fix developed, tested, and deployed |
| 30+  | Public disclosure (CVE if applicable) coordinated with reporter |

For **critical** issues (RCE, key compromise), we aim for a patch within 72 hours.

---

## Secret Management

The repo uses the following secrets — all loaded from `.env` (gitignored):

- `FMP_API_KEY` — Financial Modeling Prep
- `OPENROUTER_API_KEY` — LLM provider
- Optional: `PREFER_GROK`, `OPENROUTER_MODEL`

**Never commit `.env`** — it is in `.gitignore`. If you accidentally commit a key, immediately:

1. Rotate the key at the provider's dashboard
2. Force-push the cleaned history (`git filter-repo` or BFG)
3. Notify the maintainer

---

## Financial Disclaimer

Stock Analyst Pro is **educational software**. It does NOT constitute investment advice. Calculation bugs may lead to misleading valuations — please report them through the regular [bug-report issue template](./.github/ISSUE_TEMPLATE/bug_report.md), not as security issues.
