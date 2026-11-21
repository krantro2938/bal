import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://bal.example";
const path = "/media/vals-gavot/video-version.mp4";
const cut = 512 * 1024;
const file = Uint8Array.from({ length: cut + 93 }, (_, i) => i % 251);

function setup(supportTail = true) {
  const events = new Map();
  const requests = [];
  runInNewContext(source, {
    self: { location: { origin }, addEventListener: (name, fn) => events.set(name, fn) },
    ArrayBuffer, Uint8Array, Headers, Request, Response, ReadableStream,
    fetch: async (request) => {
      const range = request.headers.get("Range");
      requests.push(range);
      const start = Number(range.split("-")[0].slice(6));
      const end = Number(range.split("-")[1] || file.length - 1);
      if (!supportTail && start === cut) return new Response(file);
      return new Response(file.subarray(start, end + 1), { status: 206, headers: {
        "Content-Range": `bytes ${start}-${end}/${file.length}`,
      } });
    },
  });
  events.get("message")({ source: { id: "warm-tab" }, data: {
    type: "bal-video-prefix", url: path, bytes: file.slice(0, cut).buffer, total: file.length,
  } });
  function request(range, clientId = "warm-tab") {
    let response;
    const request = new Request(origin + path, { headers: { Range: range } });
    Object.defineProperty(request, "destination", { value: "video" });
    events.get("fetch")({ request, clientId, respondWith: (value) => { response = value; } });
    return response;
  }
  return { request, requests };
}

test("reuses the warmed bytes and only requests the missing tail", async () => {
  const { request, requests } = setup();
  const response = await request("bytes=0-");
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("X-Bal-Warmed-Bytes"), String(cut));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), file);
  assert.deepEqual(requests, [`bytes=${cut}-${file.length - 1}`]);
  const covered = await request("bytes=32-47");
  assert.deepEqual(new Uint8Array(await covered.arrayBuffer()), file.subarray(32, 48));
  assert.equal(requests.length, 1);
  assert.equal(request("bytes=0-", "other-tab"), undefined);
  assert.equal(request(`bytes=${cut}-`), undefined);
});

test("falls back to the original range when the tail cannot be served", async () => {
  const { request, requests } = setup(false);
  const response = await request("bytes=0-");
  assert.equal(response.headers.get("X-Bal-Warmed-Bytes"), null);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), file);
  assert.deepEqual(requests, [`bytes=${cut}-${file.length - 1}`, "bytes=0-"]);
});
