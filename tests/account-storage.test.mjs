import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountStorage } from '../js/storage.js';

function setup() {
  const map = new Map();
  const local = { getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v) };
  return { map, storage: createAccountStorage(() => local) };
}

test('signed-out state neither reads nor writes unowned legacy data', () => {
  const { map, storage } = setup();
  map.set('marketmind.strategies', JSON.stringify([{ id: 'legacy-secret' }]));
  map.set('marketmind.brand-profile', JSON.stringify({ name: 'legacy-brand' }));
  map.set('marketmind.api-settings', 'legacy-key-material');
  const before = [...map];
  assert.deepEqual(storage.getStrategies(), []);
  assert.equal(storage.getBrand(null), null);
  assert.equal(storage.saveStrategy({id:'x'}), false);
  storage.setAccount('B');
  assert.equal(storage.hasLocalData(), false);
  assert.deepEqual([...map], before);
});

test('A and B backups remain separate across account changes and reinitialization', () => {
  const { map, storage } = setup();
  storage.setAccount('A');
  storage.saveBrand({name:'A private'});storage.saveWorkspace({workspaceName:'A work'});storage.saveStrategy({id:'same',idea:'A private'});
  storage.setMigrationMarker('A',{done:true});
  storage.setAccount('B');
  assert.equal(storage.getBrand(null), null);assert.deepEqual(storage.getStrategies(),[]);assert.equal(storage.getWorkspace().workspaceName,'');assert.equal(storage.getMigrationMarker('A'),null);
  storage.saveStrategy({id:'same',idea:'B private'});
  storage.setAccount(null);assert.deepEqual(storage.getStrategies(),[]);
  storage.setAccount('A');assert.equal(storage.getStrategies()[0].idea,'A private');assert.equal(storage.getBrand(null).name,'A private');assert.equal(storage.getWorkspace().workspaceName,'A work');
  assert.deepEqual(storage.getMigrationMarker('A'),{done:true});
  const restored=createAccountStorage(()=>({getItem:k=>map.get(k)??null}));restored.setAccount('B');assert.equal(restored.getStrategies()[0].idea,'B private');
});

test('account epoch rejects A results after A to B to A and logout transitions', () => {
  const {storage}=setup();storage.setAccount('A');const old=storage.capture();assert.equal(storage.isCurrent(old),true);
  storage.setAccount('B');assert.equal(storage.isCurrent(old),false);storage.setAccount('A');assert.equal(storage.isCurrent(old),false);
  const next=storage.capture();storage.setAccount('A');assert.equal(storage.isCurrent(next),true);storage.setAccount(null);assert.equal(storage.isCurrent(next),false);
});

test('blocked storage fails honestly without wiping or sharing other accounts', () => {
  const s=createAccountStorage(()=>({getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}}));s.setAccount('A');
  assert.equal(s.saveBrand({name:'A'}),false);assert.equal(s.saveWorkspace({}),false);assert.equal(s.saveStrategy({id:'A'}),false);assert.deepEqual(s.getStrategies(),[]);
});
