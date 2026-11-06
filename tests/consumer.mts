import { createDistributedLeaseManager, type LeaseAdapter } from '@lp-labs/distributed-lease';

declare const adapter: LeaseAdapter;
const manager = createDistributedLeaseManager(adapter, { ownerId: 'instance-1' });
void manager.acquire('resource', 5000);
