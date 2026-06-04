# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.5] - 2026-06-04

### Added

- `feeModel: 'live'` config option: fetch the broadcaster's current policy from ARC `GET /v1/policy` at init instead of hardcoding a rate (falls back to 100 sat/KB if the fetch fails). Exposes `parsePolicyFee` / `fetchLivePolicyFee` for direct use.

## [0.5.4] - 2026-06-04

### Fixed

- Fail loud if the 100 sat/KB fee override doesn't take effect (e.g. wallet-toolbox internals shift, or the dep is too old): read the rate back through the instance `createAction` uses and throw rather than silently broadcasting at 1 sat/KB. Logs the effective policy on init.
- Stop publishing `CLAUDE.md` (internal dev notes) in the npm tarball.

## [0.5.3] - 2026-06-03

### Added

- `broadcast()` now returns the atomic BEEF for the broadcast transaction (additive, backwards compatible).

## [0.5.2] - 2026-05-05

### Fixed

- Override the `@bsv/wallet-toolbox` default fee model of 1 sat/KB with the peck policy of 100 sat/KB so that broadcast transactions confirm reliably.

## [0.5.1] - 2026-05-05

### Fixed

- Drop a double-hash in the BRC-77 signing path.

## [0.5.0] - 2026-05-05

### Changed

- **BREAKING:** Migrate AIP signing to the BRC-77 lane.

## [0.4.0] - 2026-05-04

### Changed

- **BREAKING:** Use canonical Bitcom AIP signing with the identity key directly.

### Added

- Expose `getWalletClient()` for AuthFetch / SDK utilities.
- Expose BRC-52 certificate operations: `acquireCertificate`, `listCertificates`, `proveCertificate`.
- Expose `sendLivePayment()` for agent-to-peer payments.

### Changed

- Switch the project license to Open BSV License v5.

## [0.3.4] - 2026-04-24

### Added

- Documentation: downloads and types badges in the README.

## [0.3.0] - 2026-04-21

### Added

- Public `broadcast()` API for broadcasting arbitrary Bitcoin Schema / locking scripts.

### Changed

- Renamed the package from `peck-agent-wallet` to `bitcoin-agent-wallet`.
- Migrate keychain-based identity storage from plaintext JSON to the OS keychain.
- Use the standard `@bsv/message-box-client` PeerPay API for payment requests.

### Fixed

- Use an ESM import for `writeFileSync` in the keychain migration breadcrumb.

## [0.2.0] - 2026-04-21

### Added

- Initial BRC-100 native wallet primitive for autonomous agents on BSV.
- OS-keychain identity storage.
- PeerPay funding via `@bsv/message-box-client`.

[Unreleased]: https://github.com/kryp2/bitcoin-agent-wallet/compare/v0.5.3...HEAD
[0.5.3]: https://github.com/kryp2/bitcoin-agent-wallet/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/kryp2/bitcoin-agent-wallet/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/kryp2/bitcoin-agent-wallet/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/kryp2/bitcoin-agent-wallet/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kryp2/bitcoin-agent-wallet/compare/v0.3.4...v0.4.0
[0.3.4]: https://github.com/kryp2/bitcoin-agent-wallet/compare/v0.3.0...v0.3.4
[0.3.0]: https://github.com/kryp2/bitcoin-agent-wallet/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kryp2/bitcoin-agent-wallet/releases/tag/v0.2.0
