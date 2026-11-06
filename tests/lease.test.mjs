import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LeaseError,
  createDistributedLeaseManager,
  createMemoryLeaseAdapter,
} from '../dist/esm/index.js';

test('acquire is exclusive while live and expiration is an exact exclusive boundary', async () => {
  let time = 100;
  const adapter = createMemoryLeaseAdapter(() => time);
  const firstOwner = createDistributedLeaseManager(adapter, { ownerId: 'worker-a' });
  const secondOwner = createDistributedLeaseManager(adapter, { ownerId: 'worker-b' });
  const first = await firstOwner.acquire('resource', 10);
  assert.ok(first);
  assert.equal(first.expiresAt, 110);
  assert.equal(await secondOwner.acquire('resource', 10), null);
  time = 110;
  const second = await secondOwner.acquire('resource', 10);
  assert.ok(second);
  assert.ok(second.fencingToken > first.fencingToken);
});

test('stale owner cannot renew or release a successor lease', async () => {
  let time = 0;
  const adapter = createMemoryLeaseAdapter(() => time);
  const ownerA = createDistributedLeaseManager(adapter, { ownerId: 'A' });
  const ownerB = createDistributedLeaseManager(adapter, { ownerId: 'B' });
  const stale = await ownerA.acquire('k', 5);
  time = 5;
  const current = await ownerB.acquire('k', 20);
  assert.ok(stale && current);
  assert.equal(await stale.renew(10), false);
  assert.equal(await stale.release(), false);
  assert.equal(await ownerA.acquire('k', 2), null);
  assert.equal(current.active, true);
  assert.equal(await current.release(), true);
});

test('renewal extends the current lease and release is idempotent', async () => {
  let time = 5;
  const adapter = createMemoryLeaseAdapter(() => time);
  const manager = createDistributedLeaseManager(adapter, { ownerId: 'owner' });
  const lease = await manager.acquire('k', 10);
  assert.ok(lease);
  time = 10;
  assert.equal(await lease.renew(20), true);
  assert.equal(lease.expiresAt, 30);
  assert.equal(await lease.release(), true);
  assert.equal(await lease.release(), false);
  assert.equal(lease.active, false);
  assert.equal(await lease.renew(20), false);
});

test('simultaneous in-process acquire attempts yield exactly one lease', async () => {
  const adapter = createMemoryLeaseAdapter(() => 1);
  const managers = ['a', 'b'].map((ownerId) => createDistributedLeaseManager(adapter, { ownerId }));
  const results = await Promise.all(managers.map((manager) => manager.acquire('key', 100)));
  assert.equal(results.filter(Boolean).length, 1);
});

test('adapter results are validated and invalid keys and TTLs fail', async () => {
  const manager = createDistributedLeaseManager(
    createMemoryLeaseAdapter(() => 1),
    {
      ownerId: 'owner',
    },
  );
  await assert.rejects(manager.acquire('', 10), LeaseError);
  await assert.rejects(manager.acquire('key', 0), LeaseError);
  const invalid = createDistributedLeaseManager(
    {
      acquire: () => ({ owner: 'wrong', fencingToken: 1, expiresAt: 10 }),
      renew: () => null,
      release: () => false,
    },
    { ownerId: 'owner' },
  );
  await assert.rejects(invalid.acquire('key', 1), { code: 'adapter' });
});
