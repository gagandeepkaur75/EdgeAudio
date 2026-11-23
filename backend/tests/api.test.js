// Black-box API tests against a local backend instance (throwaway test credentials generated here only).
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const pw = 'test-' + Math.random().toString(36).slice(2);
const env = { ...process.env, PORT: '3911', ADMIN_USERNAME: 'testadmin', ADMIN_PASSWORD_HASH: bcrypt.hashSync(pw, 10),
  JWT_SECRET: require('crypto').randomBytes(32).toString('hex'), DB_PATH: require('path').join(__dirname, 'tmp', 'test.db'), ALLOWED_ORIGINS: '', LOCAL_UPLOAD_URL: 'http://localhost:3911',
  S3_ACCESS_KEY_ID: '', S3_BUCKET: '' };
require('fs').rmSync(require('path').join(__dirname, 'tmp'), { recursive: true, force: true });
const srv = spawn(process.execPath, [require('path').join(__dirname, '..', 'src', 'index.js')], { env, stdio: ['ignore', 'ignore', 'inherit'] });
const B = 'http://localhost:3911';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
async function t(id, name, fn) { try { const d = await fn(); results.push({ id, name, status: 'PASS', detail: d }); } catch (e) { results.push({ id, name, status: 'FAIL', detail: e.message }); } }
const j = (r) => r.json();
const post = (p, body, h = {}) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body) });
function expect(c, msg) { if (!c) throw new Error(msg); }
(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/health'); break; } catch { await sleep(150); } }
  let token, fileKey, fileUrl;
  await t('API-01', 'Health check', async () => { const r = await fetch(B + '/api/health'); expect(r.status === 200, 'status ' + r.status); return 'HTTP 200'; });
  await t('API-02', 'Login with valid credentials returns JWT', async () => { const r = await post('/api/auth/login', { username: 'testadmin', password: pw }); const b = await j(r); expect(r.status === 200 && b.token, 'status ' + r.status); token = b.token; return 'HTTP 200, token issued, expiresIn=' + b.expiresIn; });
  await t('API-03', 'Login with wrong password rejected', async () => { const r = await post('/api/auth/login', { username: 'testadmin', password: 'wrong' }); expect(r.status === 401, 'status ' + r.status); return 'HTTP 401'; });
  await t('API-04', 'Upload without token rejected', async () => { const r = await fetch(B + '/api/upload', { method: 'POST' }); expect(r.status === 401, 'status ' + r.status); return 'HTTP 401'; });
  await t('API-05', 'Authenticated upload stores file', async () => { const fd = new FormData(); fd.append('file', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'test.pdf'); const r = await fetch(B + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd }); const b = await j(r); expect(r.ok && b.fileKey, 'status ' + r.status + ' ' + JSON.stringify(b)); fileKey = b.fileKey; fileUrl = b.fileUrl; return 'HTTP ' + r.status + ', fileKey returned'; });
  const meta = () => ({ slug: 'test-v1', title: 'Test deliverable', deliverableType: 'planning', version: 'v1', presentationDate: '2026-11-20', authors: 'Team', fileKey, fileUrl, originalFilename: 'test.pdf', sizeBytes: 13 });
  await t('API-06', 'Publish new deliverable version', async () => { const r = await post('/api/publish', meta(), { Authorization: 'Bearer ' + token }); expect(r.status === 201 || r.status === 200, 'status ' + r.status + ' ' + await r.text()); return 'HTTP ' + r.status; });
  await t('API-07', 'Re-publishing an existing slug is refused', async () => { const r = await post('/api/publish', meta(), { Authorization: 'Bearer ' + token }); expect(r.status === 409, 'status ' + r.status); return 'HTTP 409'; });
  await t('API-08', 'Reserved slug rejected', async () => { const r = await post('/api/publish', { ...meta(), slug: 'admin' }, { Authorization: 'Bearer ' + token }); expect(r.status === 400, 'status ' + r.status); return 'HTTP 400'; });
  await t('API-09', 'Bad date format rejected', async () => { const r = await post('/api/publish', { ...meta(), slug: 'test-v9', presentationDate: '20-11-2026' }, { Authorization: 'Bearer ' + token }); expect(r.status === 400, 'status ' + r.status); return 'HTTP 400'; });
  await t('API-10', 'Public list and fetch by slug', async () => { const r = await fetch(B + '/api/deliverables'); const r2 = await fetch(B + '/api/deliverables/test-v1'); expect(r.ok && r2.ok, 'status ' + r.status + '/' + r2.status); return 'list HTTP 200, slug HTTP 200'; });
  await t('API-11', 'Unknown slug returns 404', async () => { const r = await fetch(B + '/api/deliverables/does-not-exist'); expect(r.status === 404, 'status ' + r.status); return 'HTTP 404'; });
  await t('API-12', 'Peer cannot join a non-existent room', async () => { const r = await post('/api/meeting/join', { meetingId: 'NOROOM', userId: 'p1', role: 'peer' }); expect(r.status === 404, 'status ' + r.status); return 'HTTP 404'; });
  await t('API-13', 'Host creates room, peer joins, signal relayed exactly once', async () => {
    let r = await post('/api/meeting/join', { meetingId: 'room1', userId: 'h1', role: 'host' }); expect(r.ok, 'host ' + r.status);
    r = await post('/api/meeting/join', { meetingId: 'ROOM1', userId: 'p1', role: 'peer' }); const b = await j(r); expect(b.participantCount === 2, 'count ' + b.participantCount);
    r = await post('/api/meeting/signal', { meetingId: 'ROOM1', senderId: 'h1', targetId: 'p1', signalData: { type: 'offer', sdp: 'v=0' } }); expect(r.ok, 'signal ' + r.status);
    let p = await j(await fetch(B + '/api/meeting/ROOM1/poll?userId=p1')); expect(p.signals.length === 1, 'first poll ' + p.signals.length);
    p = await j(await fetch(B + '/api/meeting/ROOM1/poll?userId=p1')); expect(p.signals.length === 0, 'second poll ' + p.signals.length);
    return 'count=2; offer delivered on 1st poll, empty on 2nd'; });
  await t('API-14', 'Oversized signal rejected', async () => { const r = await post('/api/meeting/signal', { meetingId: 'ROOM1', senderId: 'h1', signalData: { sdp: 'x'.repeat(17000) } }); expect(r.status === 413, 'status ' + r.status); return 'HTTP 413'; });
  await t('API-15', 'Sender outside room cannot signal', async () => { const r = await post('/api/meeting/signal', { meetingId: 'ROOM1', senderId: 'intruder', signalData: { a: 1 } }); expect(r.status === 403, 'status ' + r.status); return 'HTTP 403'; });
  await t('API-16', 'Room full after 8 users', async () => { for (let i = 2; i <= 7; i++) await post('/api/meeting/join', { meetingId: 'ROOM1', userId: 'u' + i, role: 'peer' }); const r = await post('/api/meeting/join', { meetingId: 'ROOM1', userId: 'u9', role: 'peer' }); expect(r.status === 409, 'status ' + r.status); return 'HTTP 409 on 9th join'; });
  await t('API-17', 'Login lockout after 5 failures', async () => { let last; for (let i = 0; i < 6; i++) last = await post('/api/auth/login', { username: 'testadmin', password: 'bad' + i }); expect(last.status === 429, 'status ' + last.status); return 'HTTP 429 after repeated failures'; });
  srv.kill();
  require('fs').writeFileSync(require('path').join(__dirname, 'tmp', 'results.json'), JSON.stringify({ when: new Date().toISOString(), node: process.version, results }, null, 2));
  for (const r of results) console.log(r.id, r.status, r.name, '|', r.detail);
  process.exit(results.some((r) => r.status !== 'PASS') ? 1 : 0);
})();
