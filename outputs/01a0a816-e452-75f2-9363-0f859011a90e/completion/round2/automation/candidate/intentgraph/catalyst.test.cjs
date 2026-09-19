'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  AUTH_PATH,
  CATALYST_FINGERPRINT256,
  CATALYST_HOST,
  createCatalystClient,
  createPinnedAgent
} = require('./catalyst.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentgraph-catalyst-'));
  const runtimeDirectory = path.join(root, '.intentgraph', 'runtime');
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  return { root, runtimeDirectory };
}

function trust(runtimeDirectory, extra = '') {
  fs.writeFileSync(path.join(runtimeDirectory, 'catalyst-trust.json'), `${extra}{"host":"${CATALYST_HOST}","fingerprint256":"${CATALYST_FINGERPRINT256}"}\n`, 'utf8');
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('pinned agent withholds the socket until secureConnect pin verification', () => {
  let socket;
  let callbackArgs;
  const agent = createPinnedAgent({
    host: CATALYST_HOST,
    expectedFingerprint: CATALYST_FINGERPRINT256,
    tlsModule: {
      connect: () => {
        socket = new EventEmitter();
        socket.setTimeout = () => {};
        socket.destroy = () => {};
        socket.getPeerCertificate = () => ({ fingerprint256: CATALYST_FINGERPRINT256 });
        return socket;
      }
    }
  });
  try {
    const returned = agent.createConnection({ host: CATALYST_HOST, port: 443 }, (...args) => { callbackArgs = args; });
    assert.equal(returned, undefined);
    assert.equal(callbackArgs, undefined);
    socket.emit('secureConnect');
    assert.equal(callbackArgs[0], null);
    assert.equal(callbackArgs[1], socket);
  } finally {
    agent.destroy();
  }
});

test('status is local-only and trust is required before credentials or network', async () => {
  const { root, runtimeDirectory } = fixture();
  let secretCalls = 0;
  let requestCalls = 0;
  const client = createCatalystClient({
    runtimeDirectory,
    getSecret: async () => { secretCalls += 1; return 'should-not-be-read'; },
    request: async () => { requestCalls += 1; return { status: 200, body: {} }; }
  });
  try {
    const status = client.status();
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'trust file missing');
    assert.equal(secretCalls, 0);
    assert.equal(requestCalls, 0);
    await assert.rejects(() => client.inventory(), /Catalyst trust is not configured/);
    assert.equal(secretCalls, 0);
    assert.equal(requestCalls, 0);

    fs.writeFileSync(path.join(runtimeDirectory, 'catalyst-trust.json'), JSON.stringify({ host: 'wrong.example', fingerprint256: CATALYST_FINGERPRINT256 }), 'utf8');
    assert.equal(client.status().enabled, false);
    await assert.rejects(() => client.inventory(), /Catalyst trust is not configured/);
    assert.equal(secretCalls, 0);
    assert.equal(requestCalls, 0);
  } finally {
    await client.close();
    cleanup(root);
  }
});

test('TLS pin rejection happens before authentication and no raw token is returned', async () => {
  const { root, runtimeDirectory } = fixture();
  trust(runtimeDirectory);
  let connectCalls = 0;
  let secretCalls = 0;
  let requestCalls = 0;
  const client = createCatalystClient({
    runtimeDirectory,
    getSecret: async () => { secretCalls += 1; return 'password'; },
    connect: async () => { connectCalls += 1; return { fingerprint256: '00:00' }; },
    request: async () => { requestCalls += 1; return { status: 200, body: {} }; }
  });
  try {
    await assert.rejects(() => client.inventory(), /Catalyst TLS pin rejected/);
    assert.equal(connectCalls, 1);
    assert.equal(secretCalls, 0, 'credentials must be read only after pin verification');
    assert.equal(requestCalls, 0, 'authentication must not receive a request after pin rejection');
  } finally {
    await client.close();
    cleanup(root);
  }
});

test('inventory authenticates once, normalizes devices, redacts tokens, and caches for 30 seconds', async () => {
  const { root, runtimeDirectory } = fixture();
  // PowerShell Set-Content may produce a UTF-8 BOM; the trust parser accepts it.
  trust(runtimeDirectory, '\uFEFF');
  let current = 1_000;
  let connectCalls = 0;
  let secretCalls = 0;
  const calls = [];
  const token = 'PRIVATE-CATALYST-TOKEN';
  const client = createCatalystClient({
    runtimeDirectory,
    clock: () => current,
    getSecret: async (ref) => { secretCalls += 1; assert.equal(ref, 'network-catalyst-shared'); return 'private-password'; },
    connect: async (details) => { connectCalls += 1; assert.equal(details.host, CATALYST_HOST); assert.equal(details.fingerprint256, CATALYST_FINGERPRINT256); return { fingerprint256: CATALYST_FINGERPRINT256 }; },
    request: async (request) => {
      calls.push(request);
      if (request.phase === 'authentication') {
        assert.equal(request.method, 'POST');
        assert.equal(request.route, '/dna/system/api/v1/auth/token');
        assert.match(request.headers.Authorization, /^Basic /);
        return { status: 200, body: { Token: token, ignored: 'private' } };
      }
      assert.equal(request.phase, 'inventory');
      assert.equal(request.method, 'GET');
      assert.equal(request.route, '/dna/intent/api/v1/network-device?limit=25');
      assert.equal(request.headers['X-Auth-Token'], token);
      return {
        status: 200,
        body: {
          response: [
            { id: 'aa754801-8895-41e8-8ca5-27ee415c9c42', hostname: 'edge-1', platformId: 'C9300', managementIpAddress: '192.0.2.10', softwareVersion: '17.9.4', reachabilityStatus: 'Reachable', rawSecret: token },
            { name: 'edge-2', platform: 'C9500', managementIp: '192.0.2.11', version: '17.6.5', reachability: 'Unreachable' }
          ]
        }
      };
    }
  });
  try {
    const [first, second] = await Promise.all([client.inventory(), client.inventory()]);
    assert.deepEqual(first, second);
    assert.deepEqual(first, {
      source: 'cisco-catalyst',
      retrievedAt: new Date(current).toISOString(),
      devices: [
        { id: 'aa754801-8895-41e8-8ca5-27ee415c9c42', hostname: 'edge-1', platform: 'C9300', managementIp: '192.0.2.10', softwareVersion: '17.9.4', reachability: 'Reachable' },
        { hostname: 'edge-2', platform: 'C9500', managementIp: '192.0.2.11', softwareVersion: '17.6.5', reachability: 'Unreachable' }
      ]
    });
    assert.equal(JSON.stringify(first).includes(token), false);
    assert.equal(connectCalls, 1);
    assert.equal(secretCalls, 1);
    assert.equal(calls.length, 2);

    current += 10_000;
    const cached = await client.inventory();
    assert.deepEqual(cached, first);
    assert.equal(calls.length, 2, 'cache should avoid a second authentication and inventory request');

    current += 30_001;
    await client.inventory();
    assert.equal(calls.length, 4, 'expired cache should refetch');
  } finally {
    await client.close();
    cleanup(root);
  }
});

test('redirects and malformed inventory are generic failures without raw response data', async () => {
  const { root, runtimeDirectory } = fixture();
  trust(runtimeDirectory);
  let phase = 'authentication';
  let redirectOnce = true;
  const raw = 'RAW-RESPONSE-DO-NOT-RETURN';
  const client = createCatalystClient({
    runtimeDirectory,
    getSecret: async () => 'password',
    connect: async () => ({ fingerprint256: CATALYST_FINGERPRINT256 }),
    request: async ({ route }) => {
      if (phase === 'authentication' && redirectOnce) {
        redirectOnce = false;
        return { status: 302, body: { location: 'https://attacker.example', raw } };
      }
      if (route === AUTH_PATH) return { status: 200, body: { Token: 'private-token' } };
      return { status: 200, body: { raw, response: {} } };
    }
  });
  try {
    await assert.rejects(() => client.inventory(), /Catalyst redirect rejected/);
    assert.equal(client.status().reason, null);
    phase = 'inventory';
    await assert.rejects(() => client.inventory(), /Catalyst response was malformed|Catalyst inventory response was malformed/);
    assert.equal(JSON.stringify(client.status()).includes(raw), false);
  } finally {
    await client.close();
    cleanup(root);
  }
});

test('command runner sends a bounded JSON body, polls only validated ids, and returns SUCCESS output', async () => {
  const { root, runtimeDirectory } = fixture();
  trust(runtimeDirectory);
  const taskId = '01a09be0-e9f4-7a1c-9a56-2544e1fb8980';
  const fileId = 'fdfe101c-6702-453d-bff6-ef584e53723b';
  const calls = [];
  let polls = 0;
  const client = createCatalystClient({
    runtimeDirectory,
    getSecret: async () => 'private-password',
    connect: async () => ({ fingerprint256: CATALYST_FINGERPRINT256 }),
    request: async (request) => {
      calls.push(request);
      if (request.phase === 'authentication') return { status: 200, body: { Token: 'private-token' } };
      if (request.phase === 'command submission') {
        assert.equal(request.route, '/dna/intent/api/v1/network-device-poller/cli/read-request');
        assert.deepEqual(request.body.commands, ['show version']);
        assert.deepEqual(request.body.deviceUuids, ['aa754801-8895-41e8-8ca5-27ee415c9c42']);
        return { status: 202, body: { response: { taskId, url: 'https://attacker.example/task' } } };
      }
      if (request.phase === 'command task') {
        assert.equal(request.route, `/dna/intent/api/v1/task/${taskId}`);
        polls += 1;
        return { status: 200, body: { response: { isError: false, progress: polls === 1 ? '{}' : JSON.stringify({ fileId }) } } };
      }
      assert.equal(request.phase, 'command output');
      assert.equal(request.route, `/dna/intent/api/v1/file/${fileId}`);
      return { status: 200, body: [{ deviceUuid: 'aa754801-8895-41e8-8ca5-27ee415c9c42', commandResponses: { SUCCESS: { 'show version': 'show version\nsw1#' }, BLOCKLISTED: {}, FAILURE: {} } }] };
    }
  });
  try {
    const result = await client.runCommand({ command: 'show version', deviceUuid: 'aa754801-8895-41e8-8ca5-27ee415c9c42' });
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.output, 'show version\nsw1#');
    assert.equal(polls, 2);
    assert.equal(calls.some((call) => String(call.route).includes('attacker')), false);
  } finally {
    await client.close();
    cleanup(root);
  }
});

test('command runner refuses invalid ids and distinguishes blocklisted output', async () => {
  const { root, runtimeDirectory } = fixture();
  trust(runtimeDirectory);
  let calls = 0;
  const client = createCatalystClient({
    runtimeDirectory,
    getSecret: async () => 'private-password',
    request: async () => { calls += 1; return { status: 200, body: {} }; }
  });
  try {
    await assert.rejects(() => client.runCommand({ command: 'show version', deviceUuid: 'not-a-uuid' }), /invalid/i);
    await assert.rejects(() => client.runCommand({ command: 'configure terminal', deviceUuid: 'aa754801-8895-41e8-8ca5-27ee415c9c42' }), /not allowed/i);
    assert.equal(calls, 0);
  } finally { await client.close(); cleanup(root); }
});

test('device failure output preserves whitespace and failure status',async()=>{
 const {root,runtimeDirectory}=fixture();trust(runtimeDirectory);
 const raw='show ip bgp summary\r\n  % BGP not active\r\nsw1#';
 const client=createCatalystClient({runtimeDirectory,getSecret:async()=> 'test-secret',request:async r=>{
  if(r.phase==='authentication')return {status:200,body:{Token:'test-token'}};
  if(r.phase==='command submission')return {status:202,body:{response:{taskId:'01a09be0-e9f4-7a1c-9a56-2544e1fb8980'}}};
  if(r.phase==='command task')return {status:200,body:{response:{progress:JSON.stringify({fileId:'fdfe101c-6702-453d-bff6-ef584e53723b'})}}};
  return {status:200,body:[{deviceUuid:'aa754801-8895-41e8-8ca5-27ee415c9c42',commandResponses:{FAILURE:{'show ip bgp summary':raw}}}]};
 }});try{const result=await client.runCommand({command:'show ip bgp summary',deviceUuid:'aa754801-8895-41e8-8ca5-27ee415c9c42'});assert.equal(result.output,raw);assert.equal(result.status,'FAILURE');}finally{await client.close();cleanup(root);}
});

test('oversized output and abort after POST preserve unknown submission without resubmission', async () => {
 for (const mode of ['oversize','abort']) {
  const {root,runtimeDirectory}=fixture();trust(runtimeDirectory);let posts=0;const controller=new AbortController();
  const client=createCatalystClient({runtimeDirectory,getSecret:async()=> 'test-secret',request:async r=>{
   if(r.phase==='authentication')return {status:200,body:{Token:'test-token'}};
   if(r.phase==='command submission'){posts++;if(mode==='abort')controller.abort();return {status:202,body:{response:{taskId:'01a09be0-e9f4-7a1c-9a56-2544e1fb8980'}}};}
   if(r.phase==='command task')return {status:200,body:{response:{progress:JSON.stringify({fileId:'fdfe101c-6702-453d-bff6-ef584e53723b'})}}};
   return {status:200,body:[{deviceUuid:'aa754801-8895-41e8-8ca5-27ee415c9c42',commandResponses:{SUCCESS:{'show version':'x'.repeat(524289)}}}]};
  }});
  try{await assert.rejects(client.runCommand({command:'show version',deviceUuid:'aa754801-8895-41e8-8ca5-27ee415c9c42',signal:controller.signal}),e=>e.submitted===true);assert.equal(posts,1);}finally{await client.close();cleanup(root);}
 }
});
