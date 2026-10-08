import 'fake-indexeddb/auto';
import {describe,it,expect,vi} from 'vitest';
import {vaultEnsure,vaultUpdate,vaultGet} from '../src/core/vault';
import {newestSnapshot} from '../src/core/providers';
import type {Snapshot} from '../src/core/sourceState';

describe('device vault concurrency',()=>{
  it('keeps one device identity when two contexts initialize together',async()=>{
    const [a,b]=await Promise.all([vaultEnsure('test-identity',{id:'first'}),vaultEnsure('test-identity',{id:'second'})]);
    expect(a.id).toBe(b.id);expect((await vaultGet<{id:string}>('test-identity'))?.id).toBe(a.id);
  });
  it('keeps credentials readable across independently initialized browser contexts',async()=>{
    const first=await import('../src/core/vault');vi.resetModules();const second=await import('../src/core/vault');
    const [a,b]=await Promise.all([first.saveCredential('fixture-first-secret'),second.saveCredential('fixture-second-secret')]);
    expect(await second.readCredential(a)).toBe('fixture-first-secret');expect(await first.readCredential(b)).toBe('fixture-second-secret');
  });
  it('preserves a newer persisted observation when an older request finishes last',async()=>{
    const newer:Snapshot={metrics:[],observedAt:'2026-10-07T12:10:00Z',receivedAt:'2026-10-07T12:11:00Z'},older:Snapshot={metrics:[],observedAt:'2026-10-07T12:00:00Z',receivedAt:'2026-10-07T12:30:00Z'};
    await Promise.all([vaultUpdate<Snapshot>('test-sample',saved=>newestSnapshot(saved,newer)),vaultUpdate<Snapshot>('test-sample',saved=>newestSnapshot(saved,older))]);
    expect((await vaultGet<Snapshot>('test-sample'))?.observedAt).toBe(newer.observedAt);expect((await vaultGet<Snapshot>('test-sample'))?.receivedAt).toBe(newer.receivedAt);
  });
});
