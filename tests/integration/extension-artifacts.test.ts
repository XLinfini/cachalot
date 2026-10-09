import assert from "node:assert/strict";
import { test } from "node:test";
import "fake-indexeddb/auto";
import { ArtifactRepository } from "../../src/infrastructure/extensions/artifacts";

test("artifact blobs are isolated by owner, replace atomically and survive repository recreation", async () => {
  const repo = new ArtifactRepository();
  const input = {
    id: "checkpoint",
    name: "checkpoint.json",
    mediaType: "application/json",
    sourceDocumentId: "paper",
    bytes: new Uint8Array([1, 2, 3]),
  };
  const writing = repo.write("fixture.one", input);
  input.bytes[0] = 9;
  input.name = "changed.json";
  const original = await writing;
  assert.equal(
    original.name,
    "checkpoint.json",
    "write captures metadata and bytes before yielding",
  );
  assert.deepEqual(await repo.read("fixture.one", input.id), new Uint8Array([1, 2, 3]));
  await assert.rejects(repo.read("fixture.two", input.id), /not found/);
  await repo.write("fixture.two", { ...input, bytes: new Uint8Array([7]) });
  await repo.write("fixture.one", { ...input, bytes: new Uint8Array([4, 5]) });
  const restored = new ArtifactRepository(),
    list = await restored.list("fixture.one", "paper");
  assert.equal(list.length, 1);
  assert.equal(list[0].createdAt, original.createdAt);
  assert.equal(list[0].byteLength, 2);
  assert.ok(!("bytes" in list[0]) && !("owner" in list[0]));
  assert.deepEqual(await restored.list("fixture.one", "other"), []);
  await restored.delete("fixture.one", "checkpoint");
  assert.deepEqual(await restored.list("fixture.one"), []);
  assert.deepEqual(await restored.read("fixture.two", "checkpoint"), new Uint8Array([7]));
});
test("artifact storage rejects invalid paths and cancellation never replaces the committed checkpoint", async () => {
  const repo = new ArtifactRepository(),
    owner = "fixture.cancel";
  const input = {
    id: "job",
    name: "job.pdf",
    mediaType: "application/pdf",
    bytes: new Uint8Array([1]),
  };
  await repo.write(owner, input);
  await assert.rejects(repo.write(owner, { ...input, id: "../other" }), /artifact ID/);
  await assert.rejects(repo.write(owner, { ...input, name: "../job.pdf" }), /artifact name/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    repo.write(owner, { ...input, bytes: new Uint8Array([2]) }, controller.signal),
    { name: "AbortError" },
  );
  assert.deepEqual(await repo.read(owner, "job"), new Uint8Array([1]));
});
