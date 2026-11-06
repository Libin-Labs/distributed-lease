import leaseModule = require('@lp-labs/distributed-lease');

const adapter = leaseModule.createMemoryLeaseAdapter();
const manager = leaseModule.createDistributedLeaseManager(adapter, { ownerId: 'local' });
void manager.acquire('resource', 1000);
