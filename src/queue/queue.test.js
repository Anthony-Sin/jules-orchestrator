import test from 'node:test';
import assert from 'node:assert';
import { enqueue, dequeue } from './queue.js';
import { store as confStore } from '../state/store.js';

test('Queue functions', async (t) => {
  const mockData = new Map();

  t.mock.method(confStore, 'get', (key, defaultValue) => {
    return mockData.has(key) ? mockData.get(key) : defaultValue;
  });

  t.mock.method(confStore, 'set', (key, value) => {
    mockData.set(key, value);
  });

  await t.test('enqueue adds task and sorts by priority', () => {
    mockData.clear();
    mockData.set('queue', []);

    enqueue({ id: 1, priority: 10, type: 'test' });
    let queue = mockData.get('queue');
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].id, 1);
    assert.ok(queue[0].queuedAt);

    enqueue({ id: 2, priority: 20, type: 'test' });
    queue = mockData.get('queue');
    assert.strictEqual(queue.length, 2);
    assert.strictEqual(queue[0].id, 2);
    assert.strictEqual(queue[1].id, 1);

    enqueue({ id: 3, priority: 5, type: 'test' });
    queue = mockData.get('queue');
    assert.strictEqual(queue.length, 3);
    assert.strictEqual(queue[0].id, 2);
    assert.strictEqual(queue[1].id, 1);
    assert.strictEqual(queue[2].id, 3);
  });

  await t.test('dequeue returns null if no tasks match type', () => {
    mockData.clear();
    mockData.set('queue', [
      { id: 1, type: 'other', priority: 10 }
    ]);

    const task = dequeue('test');
    assert.strictEqual(task, null);
    assert.strictEqual(mockData.get('queue').length, 1);
  });

  await t.test('dequeue returns highest priority task of requested type', () => {
    mockData.clear();
    mockData.set('queue', [
      { id: 1, type: 'test', priority: 10 },
      { id: 2, type: 'other', priority: 20 },
      { id: 3, type: 'test', priority: 5 }
    ]);

    const task = dequeue('test');
    assert.strictEqual(task.id, 1);
    const queue = mockData.get('queue');
    assert.strictEqual(queue.length, 2);
    assert.strictEqual(queue[0].id, 2);
    assert.strictEqual(queue[1].id, 3);
  });

  await t.test('dequeue skips tasks with file conflicts', () => {
    mockData.clear();
    mockData.set('queue', [
      { id: 1, type: 'test', priority: 20, estimatedFiles: ['conflicted.txt'] },
      { id: 2, type: 'test', priority: 10, estimatedFiles: ['ok.txt'] }
    ]);

    mockData.set('fileLocks', {
      'conflicted.txt': 'session-1'
    });

    const task = dequeue('test');

    assert.strictEqual(task.id, 2);
    const queue = mockData.get('queue');
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].id, 1);
  });
});
