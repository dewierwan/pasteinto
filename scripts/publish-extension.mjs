// Uploads the packed extension to the Chrome Web Store and submits it for
// review, when manifest.json has a version the store has not seen yet. CI runs
// this on every push to main, so a release is: bump "version", push.
// Usage: node scripts/publish-extension.mjs [--dry-run]
// Needs two environment variables (README.md, "One-time setup"):
//   CWS_SERVICE_ACCOUNT_KEY  the JSON key of the Google service account
//   CWS_PUBLISHER_ID         from the Developer Dashboard, Publisher > Settings
import { readFileSync, existsSync } from 'fs';
import { createSign } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ITEM_ID = 'cafcglpffcdbmioicikgpiobcpfpkcge';
const API = 'https://chromewebstore.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const UPLOAD_POLL_MS = 5000;
const UPLOAD_POLL_TRIES = 60; // five minutes; a small zip is processed in seconds

// Chrome compares versions part by part as numbers: 1.0.11 is higher than 1.0.4.
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

// What to do with the version in manifest.json, given what the store has.
// published and submitted are version strings, or undefined when there is none.
export function decide(manifest, published, submitted) {
  if (submitted && compareVersions(manifest, submitted) === 0) return { release: false, why: `${manifest} is already in review` };
  if (published && compareVersions(manifest, published) === 0) return { release: false, why: `${manifest} is already live` };
  const highest = [published, submitted].filter(Boolean).sort(compareVersions).pop();
  // A rollback in the dashboard republishes an old package under a higher number.
  if (highest && compareVersions(manifest, highest) < 0)
    return {
      release: false,
      behind: true,
      why: `the store has ${highest}, which is higher than ${manifest}: set a higher version to release`,
    };
  return { release: true, why: `${manifest} is new (store: ${published || 'nothing live'})` };
}

// The newest version among an item revision's channels, from fetchStatus.
function versionOf(revision) {
  const versions = ((revision && revision.distributionChannels) || []).map((c) => c.crxVersion).filter(Boolean);
  return versions.sort(compareVersions).pop();
}

// A service account signs a short-lived claim with its private key and swaps it
// for an access token. No Google library is needed.
async function accessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const claim = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: key.client_email, scope: SCOPE, aud: key.token_uri, iat: now, exp: now + 600 })}`;
  const signature = createSign('RSA-SHA256').update(claim).sign(key.private_key, 'base64url');
  const response = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${claim}.${signature}` }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(`Google refused the service account key: ${JSON.stringify(body)}`);
  return body.access_token;
}

async function call(token, method, url, body) {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` }, body });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!response.ok) throw new Error(`${method} ${url.replace(API, '')} failed (${response.status}): ${text}`);
  return json;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { version } = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf-8'));
  const rawKey = process.env.CWS_SERVICE_ACCOUNT_KEY;
  const publisher = process.env.CWS_PUBLISHER_ID;
  if (!rawKey || !publisher) {
    // Not an error: the site still deploys before the one-time setup is done.
    console.log('Skipped: CWS_SERVICE_ACCOUNT_KEY or CWS_PUBLISHER_ID is not set. See "One-time setup" in README.md.');
    return;
  }
  const token = await accessToken(JSON.parse(rawKey));
  const item = `publishers/${publisher}/items/${ITEM_ID}`;
  const status = await call(token, 'GET', `${API}/v2/${item}:fetchStatus`);
  if (status.takenDown || status.warned) console.log(`Warning from the store: takenDown=${!!status.takenDown} warned=${!!status.warned}`);
  const published = versionOf(status.publishedItemRevisionStatus);
  const submitted = versionOf(status.submittedItemRevisionStatus);
  const decision = decide(version, published, submitted);
  console.log(`${decision.release ? 'Releasing' : 'Nothing to release'}: ${decision.why}.`);
  if (!decision.release || dryRun) return;

  const zip = resolve(root, 'dist', `pasteinto-extension-${version}.zip`);
  if (!existsSync(zip)) throw new Error(`${zip} is missing: run npm run pack:extension first`);
  let upload = await call(token, 'POST', `${API}/upload/v2/${item}:upload`, readFileSync(zip));
  let state = upload.uploadState;
  for (let i = 0; state === 'IN_PROGRESS' && i < UPLOAD_POLL_TRIES; i++) {
    await new Promise((done) => setTimeout(done, UPLOAD_POLL_MS));
    state = (await call(token, 'GET', `${API}/v2/${item}:fetchStatus`)).lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') throw new Error(`The upload did not succeed (${state}): ${JSON.stringify(upload)}`);
  console.log(`Uploaded ${version}.`);

  // Submits for review; the store publishes it once the review passes.
  const submission = await call(token, 'POST', `${API}/v2/${item}:publish`);
  const warnings = (submission.warningInfo && submission.warningInfo.warnings) || [];
  for (const warning of warnings) console.log(`Store warning: ${warning.reason}: ${warning.description}`);
  console.log(`Submitted ${version} for review (state: ${submission.state}). It goes live when Google approves it.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
