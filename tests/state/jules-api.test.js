import test from 'node:test';
import assert from 'node:assert';
import nock from 'nock';
import { store } from '../../src/state/store.js';
import * as api from '../../src/state/jules-api.js';
import { DEFAULTS } from '../../config/defaults.js';

test('jules-api', async (t) => {
  const JULES_API_BASE = DEFAULTS.JULES_API_BASE;

  t.beforeEach(() => {
    // Mock store to provide config with API key
    if (store.get.mock) store.get.mock.restore();
    t.mock.method(store, 'get', (key, defaultValue) => {
      if (key === 'config') return { apiKey: 'test-api-key', autoPr: false };
      return defaultValue;
    });
    nock.cleanAll();
  });

  t.afterEach(() => {
    if (store.get.mock) store.get.mock.restore();
    nock.cleanAll();
  });

  await t.test('parseSourceDisplay', () => {
    assert.strictEqual(api.parseSourceDisplay('sources/github/owner/repo'), 'owner/repo');
    assert.strictEqual(api.parseSourceDisplay('sources/github-owner-repo'), 'owner/repo');
    assert.strictEqual(api.parseSourceDisplay('other/source'), 'other/source');
    assert.strictEqual(api.parseSourceDisplay(null), null);
    assert.strictEqual(api.parseSourceDisplay(undefined), undefined);
  });

  await t.test('createSession - success', async () => {
    nock(JULES_API_BASE, { reqheaders: { 'x-goog-api-key': 'test-api-key' } })
      .post('/sessions', body => {
        return body.prompt === 'test prompt' &&
               body.sourceContext.source === 'sources/github/owner/repo' &&
               body.requirePlanApproval === true &&
               body.sourceContext.githubRepoContext !== undefined;
      })
      .reply(200, { id: 'session-123' });

    const result = await api.createSession({
      prompt: 'test prompt',
      source: 'sources/github/owner/repo',
      requirePlanApproval: true
    });
    assert.strictEqual(result.id, 'session-123');
  });

  await t.test('createSession - with startingBranch and autoPr', async () => {
    store.get.mock.restore();
    t.mock.method(store, 'get', (key, defaultValue) => {
      if (key === 'config') return { apiKey: 'test-api-key', autoPr: true };
      return defaultValue;
    });

    nock(JULES_API_BASE)
      .post('/sessions', body => {
        return body.sourceContext.githubRepoContext.startingBranch === 'feature-branch' &&
               body.automationMode === 'AUTO_CREATE_PR';
      })
      .reply(200, { id: 'session-456' });

    const result = await api.createSession({
      prompt: 'test',
      source: 'src',
      startingBranch: 'feature-branch'
    });
    assert.strictEqual(result.id, 'session-456');
  });

  await t.test('createSession throws error when no API key', async () => {
    store.get.mock.restore();
    t.mock.method(store, 'get', (key, defaultValue) => {
      if (key === 'config') return {}; // No apiKey
      return defaultValue;
    });

    await assert.rejects(
      async () => await api.createSession({ prompt: 'test' }),
      /No API key set/
    );
  });

  await t.test('createSession handles API errors', async () => {
    nock(JULES_API_BASE)
      .post('/sessions')
      .reply(400, 'Bad Request Data');

    await assert.rejects(
      async () => await api.createSession({ prompt: 'test' }),
      /Jules API error 400 .* API Msg: Bad Request Data/
    );
  });

  await t.test('getSession - maps response fields correctly', async () => {
    nock(JULES_API_BASE)
      .get('/sessions/sess-1')
      .reply(200, {
        id: 'sess-1',
        updateTime: '2023-01-02T00:00:00Z',
        createTime: '2023-01-01T00:00:00Z',
        url: 'https://jules.app/session/sess-1',
        outputs: [{ pullRequest: { url: 'https://github.com/pr/1', title: 'Fix bug' } }],
        sourceContext: { source: 'sources/github-owner-repo' }
      });

    const session = await api.getSession('sess-1');
    assert.strictEqual(session.lastUpdated, '2023-01-02T00:00:00Z');
    assert.strictEqual(session.createdAt, '2023-01-01T00:00:00Z');
    assert.strictEqual(session.julesUrl, 'https://jules.app/session/sess-1');
    assert.strictEqual(session.pullRequestUrl, 'https://github.com/pr/1');
    assert.strictEqual(session.pullRequestTitle, 'Fix bug');
    assert.strictEqual(session.repoDisplay, 'owner/repo');
    assert.strictEqual(session.id, 'sess-1');
  });

  await t.test('getSession - API error', async () => {
    nock(JULES_API_BASE)
      .get('/sessions/sess-error')
      .reply(404);

    await assert.rejects(
      async () => await api.getSession('sess-error'),
      /Jules API error 404/
    );
  });

  await t.test('listSessions - supports pagination', async () => {
    nock(JULES_API_BASE)
      .get('/sessions')
      .query({ pageSize: '100', pageToken: 'token123' })
      .reply(200, { sessions: [{ id: 's1' }], nextPageToken: 'token456' });

    const result = await api.listSessions('token123');
    assert.deepStrictEqual(result.sessions, [{ id: 's1' }]);
    assert.strictEqual(result.nextPageToken, 'token456');
  });

  await t.test('listAllSessions - iterates through pages', async () => {
    nock(JULES_API_BASE)
      .get('/sessions')
      .query({ pageSize: '100' })
      .reply(200, { sessions: [{ id: 's1' }], nextPageToken: 'token1' });

    nock(JULES_API_BASE)
      .get('/sessions')
      .query({ pageSize: '100', pageToken: 'token1' })
      .reply(200, { sessions: [{ id: 's2' }] });

    const result = await api.listAllSessions();
    assert.deepStrictEqual(result.activities, undefined);
    assert.deepStrictEqual(result.sessions, [{ id: 's1' }, { id: 's2' }]);
  });

  await t.test('deleteSession', async () => {
    nock(JULES_API_BASE)
      .delete('/sessions/sess-del')
      .reply(200, { success: true });

    const res = await api.deleteSession('sess-del');
    assert.strictEqual(res.success, true);
  });

  await t.test('sendMessage', async () => {
    nock(JULES_API_BASE)
      .post('/sessions/sess-msg:sendMessage', { prompt: 'hello' })
      .reply(200, { messageId: 'm1' });

    const res = await api.sendMessage('sess-msg', 'hello');
    assert.strictEqual(res.messageId, 'm1');
  });

  await t.test('approvePlan', async () => {
    nock(JULES_API_BASE)
      .post('/sessions/sess-plan:approvePlan')
      .reply(200, { approved: true });

    const res = await api.approvePlan('sess-plan');
    assert.strictEqual(res.approved, true);
  });

  await t.test('getActivities', async () => {
    nock(JULES_API_BASE)
      .get('/sessions/sess-act/activities')
      .query({ pageSize: '100' })
      .reply(200, { activities: [{ id: 'a1' }] });

    const res = await api.getActivities('sess-act');
    assert.deepStrictEqual(res.activities, [{ id: 'a1' }]);
  });

  await t.test('getAllActivities - fetches multiple pages', async () => {
    nock(JULES_API_BASE)
      .get('/sessions/sess-act/activities')
      .query({ pageSize: '100' })
      .reply(200, { activities: [{ id: 'a1' }], nextPageToken: 'tok1' });

    nock(JULES_API_BASE)
      .get('/sessions/sess-act/activities')
      .query({ pageSize: '100', pageToken: 'tok1' })
      .reply(200, { activities: [{ id: 'a2' }] });

    const res = await api.getAllActivities('sess-act');
    assert.deepStrictEqual(res.activities, [{ id: 'a1' }, { id: 'a2' }]);
  });

  await t.test('getSessionActivities alias', async () => {
    nock(JULES_API_BASE)
      .get('/sessions/sess-alias/activities')
      .query({ pageSize: '100' })
      .reply(200, { activities: [{ id: 'alias-1' }] });

    const res = await api.getSessionActivities('sess-alias');
    assert.deepStrictEqual(res.activities, [{ id: 'alias-1' }]);
  });

  await t.test('listSources', async () => {
    nock(JULES_API_BASE)
      .get('/sources')
      .reply(200, { sources: [{ name: 'sources/github/test/repo' }] });

    const res = await api.listSources();
    assert.deepStrictEqual(res, [{ name: 'sources/github/test/repo', displayName: 'test/repo' }]);
  });

  await t.test('listSources handles plain array', async () => {
    nock(JULES_API_BASE)
      .get('/sources')
      .reply(200, [{ name: 'sources/github/test/repo2' }]);

    const res = await api.listSources();
    assert.deepStrictEqual(res, [{ name: 'sources/github/test/repo2', displayName: 'test/repo2' }]);
  });

  await t.test('listSources handles empty object', async () => {
    nock(JULES_API_BASE)
      .get('/sources')
      .reply(200, {});

    const res = await api.listSources();
    assert.deepStrictEqual(res, {});
  });
});
