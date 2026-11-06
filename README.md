# @lp-labs/distributed-lease

Adapter-driven lease lifecycle with monotonically increasing fencing tokens and owner/token-checked renew/release. The library does not claim that a process-local map is distributed coordination.

## Install

```sh
npm install @lp-labs/distributed-lease
```

Node 18+ or ES2022 browsers. ESM, CommonJS, and declarations are included.

## Quick start

```js
import {
  createDistributedLeaseManager,
  createMemoryLeaseAdapter,
} from '@lp-labs/distributed-lease';

// Demonstration only: use a durable atomic backend for distributed coordination.
const manager = createDistributedLeaseManager(createMemoryLeaseAdapter(), {
  ownerId: 'worker-17',
});
const lease = await manager.acquire('inventory:sku-9', 15000);
if (lease) {
  try {
    console.log('Fencing token for this work:', lease.fencingToken);
  } finally {
    await lease.release();
  }
}
```

CommonJS: `const { createDistributedLeaseManager } = require('@lp-labs/distributed-lease');`.

## API reference

Runtime exports: `createDistributedLeaseManager`, `createMemoryLeaseAdapter`, `LeaseError`.

Types: `LeaseRecord`, `LeaseAdapter`, `LeaseManagerOptions`, `LeaseHandle`, `DistributedLeaseManager`.

### `LeaseAdapter`

- `acquire(key, owner, ttlMs)` must atomically acquire an absent/expired key or return `null`. It returns `{ owner, fencingToken, expiresAt }`.
- `renew(key, owner, fencingToken, ttlMs)` must atomically extend only the currently live record matching both owner and token; it returns the same token and updated expiration, or `null` if lost/expired.
- `release(key, owner, fencingToken)` must atomically remove only the exact current record and report whether it did so.

Fencing tokens must be strictly increasing for each key, including after release/expiry, and must never be reused after backend restart or failover. Expiry must be decided consistently by the backend, ideally with its authoritative clock. Return safe-integer millisecond expirations and positive safe-integer tokens.

### Manager and handle

`createDistributedLeaseManager(adapter, { ownerId })` binds a stable per-process owner identity. `manager.acquire(key, ttlMs)` returns `null` on contention or a handle on success.

A handle exposes `key`, `owner`, `fencingToken`, live `expiresAt`, and `active`, plus `renew(ttlMs)` and `release()`. Lost/expired renewal returns false and deactivates the handle. Release deactivates the handle before calling the adapter; repeated release returns false. Backend adapter errors propagate. Invalid adapter records throw `LeaseError` with code `adapter`; invalid arguments use `invalid`.

### Process-local adapter

`createMemoryLeaseAdapter(clock?)` is a simple atomic-in-one-process adapter for tests and single-process use. It expires leases at `expiresAt <= now` and increments per-key fencing counters. It is not durable, cross-process, or a distributed lease service.

## Safety and limitations

The adapter contract is the coordination boundary. A lease is not a mutex around external systems: every protected write should carry and enforce the fencing token, rejecting tokens older than the greatest observed token. If backend atomicity, token monotonicity, expiry, or identity semantics are weak, this package cannot repair them. Use a unique owner ID per concurrently executing process, renew before expiry, and stop work when renewal fails. A lease does not prove that stale work has stopped, guarantee exactly-once execution, or handle process pauses, network partitions, clock faults, or fencing enforcement for you.

This package ships no Redis/database adapter and makes no distributed-safety claim for `createMemoryLeaseAdapter`; the quick-start snippet is process-local demonstration code only.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
