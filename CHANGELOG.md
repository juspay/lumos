## <small>1.5.3 (2026-05-04)</small>

* fix: lint/format before push + file preservation rules in test gen prompt ([5c03bb2](https://github.com/juspay/lumos/commit/5c03bb2)), closes [#4970](https://github.com/juspay/lumos/issues/4970) [#4971](https://github.com/juspay/lumos/issues/4971)

## <small>1.5.2 (2026-05-03)</small>

* fix(pr-review): paginate stale cleanup and add advisory verdict semantics ([527d04f](https://github.com/juspay/lumos/commit/527d04f)), closes [hi#volume](https://github.com/hi/issues/volume)

## <small>1.5.1 (2026-04-26)</small>

* fix: reset index and rebase onto dev branch in fix mode ([0049ef9](https://github.com/juspay/lumos/commit/0049ef9))

## 1.5.0 (2026-04-24)

* feat: add repo-agnostic PR review workflow with 10 structured checks ([0a89fa5](https://github.com/juspay/lumos/commit/0a89fa5))

## <small>1.4.3 (2026-04-23)</small>

* fix: extend credential injection to git push ([4af88a0](https://github.com/juspay/lumos/commit/4af88a0))

## <small>1.4.2 (2026-04-23)</small>

* fix: inject Bitbucket credentials into remote URL before git fetch ([b3fb1b3](https://github.com/juspay/lumos/commit/b3fb1b3))

## <small>1.4.1 (2026-04-23)</small>

* fix: replace resolvePrIdByBranch with listPrsForBranch for correct PR lookup ([78dc18c](https://github.com/juspay/lumos/commit/78dc18c))

## 1.4.0 (2026-04-22)

* feat: add PR creation mode with recursive generation guard ([ef41694](https://github.com/juspay/lumos/commit/ef41694))

## 1.3.0 (2026-04-16)

* feat: add AI-powered E2E test generation from PR diffs ([a025a1e](https://github.com/juspay/lumos/commit/a025a1e))

## 1.2.0 (2026-04-15)

* feat: resolve PR by branch, inject prior-run context, and post safe-to-merge comment ([e428d56](https://github.com/juspay/lumos/commit/e428d56))

## <small>1.1.3 (2026-04-12)</small>

* fix: delete old Lumos comments and remove dead verification code ([766e660](https://github.com/juspay/lumos/commit/766e660))

## <small>1.1.2 (2026-04-12)</small>

* fix: resolve duplicate comments and verification failures for find-by-branch PR discovery ([d3bdfdb](https://github.com/juspay/lumos/commit/d3bdfdb))

## <small>1.1.1 (2026-04-10)</small>

* fix: add prompt size diagnostics to pinpoint token budget issues ([7e5d6f9](https://github.com/juspay/lumos/commit/7e5d6f9))

## 1.1.0 (2026-04-09)

* feat: discover PR from branch name when PR ID is not provided ([937e77d](https://github.com/juspay/lumos/commit/937e77d))

## <small>1.0.1 (2026-04-09)</small>

* fix: upgrade to npm@11 for native OIDC publish support ([4f14200](https://github.com/juspay/lumos/commit/4f14200))

## 1.0.0 (2026-04-08)

- feat: add Lumos V1.1 - AI-powered Playwright test failure analyzer ([0c0edf3](https://github.com/juspay/lumos/commit/0c0edf3))
- feat: use local binary for MCP server registration instead of npx ([cf1ea73](https://github.com/juspay/lumos/commit/cf1ea73))
- fix: remove broken npm self-upgrade step from release workflow ([81441e2](https://github.com/juspay/lumos/commit/81441e2)), closes [npm/cli#9151](https://github.com/npm/cli/issues/9151)
- fix: upgrade semantic-release packages for OIDC trusted publishing ([b7ed6f3](https://github.com/juspay/lumos/commit/b7ed6f3))
- ci: configure npm publishing with semantic-release and provenance ([4bfd58f](https://github.com/juspay/lumos/commit/4bfd58f))
- Add files via upload ([3fb8649](https://github.com/juspay/lumos/commit/3fb8649))
- Add files via upload ([cea23c7](https://github.com/juspay/lumos/commit/cea23c7))
- Add files via upload ([e8d47af](https://github.com/juspay/lumos/commit/e8d47af))
- Enhance README with project details and goals ([2beb579](https://github.com/juspay/lumos/commit/2beb579))
- Initial commit ([4d8ea69](https://github.com/juspay/lumos/commit/4d8ea69))
- Merge pull request #3 from rajarshi-pal/feat-lumos-test-analyzer-base-setup ([dc5f9dd](https://github.com/juspay/lumos/commit/dc5f9dd)), closes [#3](https://github.com/juspay/lumos/issues/3)
- Update README.md ([61759a7](https://github.com/juspay/lumos/commit/61759a7))

# Changelog

All notable changes to @juspay/lumos will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project setup
- Basic functionality

## [1.0.0] - 2026-03-26

### Added

- Initial release
