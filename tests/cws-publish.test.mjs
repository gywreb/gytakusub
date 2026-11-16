// scripts/cws-publish.mjs against a fake Chrome Web Store API V2: the requests it sends
// (paths, methods, headers, bodies, per the API's discovery document) and how it reads the
// answers. Nothing here talks to Google.
import assert from "node:assert/strict";
import { publishPackage, accessTokenFromRefresh, API } from "../scripts/cws-publish.mjs";

let checks = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const rejects = async (p, re, msg) => { await assert.rejects(p, re, msg); checks++; };

const zip = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]);
const base = { zip, version: "2.6.0", publisherId: "pub-1", itemId: "anmnhodgeaojlhlinobnaakmgkdaoekk", token: "tok", sleep: async () => {}, log: () => {} };
const item = `${API}/v2/publishers/pub-1/items/anmnhodgeaojlhlinobnaakmgkdaoekk`;
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** A fake API: `answers` maps "METHOD path-suffix" to a list of responses, used in order. */
function fakeApi(answers) {
  const seen = [];
  const fetchFn = async (url, init = {}) => {
    const method = init.method || "GET";
    const key = `${method} ${url.replace(API, "")}`;
    seen.push({ key, headers: init.headers || {}, body: init.body });
    const list = answers[key];
    if (!list?.length) throw new Error(`unexpected request ${key}`);
    return list.length > 1 ? list.shift() : list[0];
  };
  return { fetchFn, seen };
}
const UPLOAD = "POST /upload/v2/publishers/pub-1/items/anmnhodgeaojlhlinobnaakmgkdaoekk:upload";
const STATUS = "GET /v2/publishers/pub-1/items/anmnhodgeaojlhlinobnaakmgkdaoekk:fetchStatus";
const PUBLISH = "POST /v2/publishers/pub-1/items/anmnhodgeaojlhlinobnaakmgkdaoekk:publish";

// 1. the straight path: upload done at once, submitted for review
{
  const api = fakeApi({ [UPLOAD]: [json(200, { uploadState: "SUCCEEDED", crxVersion: "2.6.0", itemId: "x" })], [PUBLISH]: [json(200, { state: "PENDING_REVIEW" })] });
  const r = await publishPackage({ ...base, fetchFn: api.fetchFn });
  eq(r, { crxVersion: "2.6.0", state: "PENDING_REVIEW" });
  eq(api.seen.map((s) => s.key), [UPLOAD, PUBLISH], "upload, then publish");
  eq(api.seen[0].headers.Authorization, "Bearer tok");
  eq(api.seen[0].headers["Content-Type"], "application/zip");
  eq(api.seen[0].body, zip, "the zip bytes are the upload body");
  eq(JSON.parse(api.seen[1].body), { publishType: "DEFAULT_PUBLISH" }, "published on approval, as the dashboard default");
  eq(`${API}/v2/publishers/pub-1/items/anmnhodgeaojlhlinobnaakmgkdaoekk`, item);
}

// 2. a package the store processes after answering: ask fetchStatus until it is done
{
  const api = fakeApi({
    [UPLOAD]: [json(200, { uploadState: "IN_PROGRESS" })],
    [STATUS]: [json(200, { lastAsyncUploadState: "IN_PROGRESS" }), json(200, { lastAsyncUploadState: "SUCCEEDED", submittedItemRevisionStatus: { state: "PUBLISHED", distributionChannels: [{ crxVersion: "2.5.0" }] } })],
    [PUBLISH]: [json(200, { state: "PENDING_REVIEW", warningInfo: { warnings: [{ reason: "X", description: "a warning" }] } })],
  });
  const logs = [];
  const r = await publishPackage({ ...base, fetchFn: api.fetchFn, log: (s) => logs.push(s) });
  eq(api.seen.map((s) => s.key), [UPLOAD, STATUS, STATUS, PUBLISH]);
  // the published revision's version (2.5.0) is not this upload's: no false mismatch
  eq(r.state, "PENDING_REVIEW");
  assert.ok(logs.some((l) => /warning: X a warning/.test(l)), "warnings are shown"); checks++;
}

// 3. failures say what happened
{
  await rejects(publishPackage({ ...base, fetchFn: fakeApi({ [UPLOAD]: [json(200, { uploadState: "FAILED" })] }).fetchFn }), /did not accept the package \(upload state FAILED\)/);
  await rejects(publishPackage({ ...base, fetchFn: fakeApi({ [UPLOAD]: [json(200, { uploadState: "SUCCEEDED", crxVersion: "2.5.0" })] }).fetchFn }), /holds version 2\.5\.0, but this release is 2\.6\.0/);
  await rejects(publishPackage({ ...base, fetchFn: fakeApi({ [UPLOAD]: [json(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "The caller does not have permission" } })] }).fetchFn }), /Upload failed: HTTP 403 PERMISSION_DENIED: The caller does not have permission/);
  await rejects(publishPackage({ ...base, fetchFn: fakeApi({ [UPLOAD]: [json(200, { uploadState: "SUCCEEDED", crxVersion: "2.6.0" })], [PUBLISH]: [json(400, { error: { status: "FAILED_PRECONDITION", message: "Item is in review" } })] }).fetchFn }), /Submitting for review failed: HTTP 400 FAILED_PRECONDITION: Item is in review/);
  await rejects(publishPackage({ ...base, fetchFn: fakeApi({ [UPLOAD]: [json(200, { uploadState: "SUCCEEDED", crxVersion: "2.6.0" })], [PUBLISH]: [json(200, { state: "REJECTED" })] }).fetchFn }), /did not take the submission \(state REJECTED\)/);
  await rejects(publishPackage({ ...base, maxPolls: 3, fetchFn: fakeApi({ [UPLOAD]: [json(200, { uploadState: "IN_PROGRESS" })], [STATUS]: [json(200, { lastAsyncUploadState: "IN_PROGRESS" })] }).fetchFn }), /still processing the upload/);
}

// 4. --no-publish uploads only
{
  const api = fakeApi({ [UPLOAD]: [json(200, { uploadState: "SUCCEEDED", crxVersion: "2.6.0" })] });
  const r = await publishPackage({ ...base, publish: false, fetchFn: api.fetchFn });
  eq(api.seen.map((s) => s.key), [UPLOAD]);
  eq(r.state, null);
}

// 5. the refresh-token fallback
{
  const seen = [];
  const fetchFn = async (url, init) => { seen.push({ url, body: String(init.body) }); return json(200, { access_token: "fresh" }); };
  eq(await accessTokenFromRefresh({ clientId: "c", clientSecret: "s", refreshToken: "r" }, fetchFn), "fresh");
  eq(seen[0].url, "https://oauth2.googleapis.com/token");
  assert.ok(/grant_type=refresh_token/.test(seen[0].body) && /refresh_token=r/.test(seen[0].body)); checks++;
  await rejects(accessTokenFromRefresh({ clientId: "c", clientSecret: "s", refreshToken: "old" }, async () => json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." })), /token exchange failed: invalid_grant \(Token has been expired or revoked\.\)/);
}

console.log(`cws-publish: ${checks} checks passed`);
