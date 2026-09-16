import { describe, it, expect, afterEach } from "vitest";
import { sql } from "kysely";
import { v1 as uuidV1 } from "uuid";
import { testDb } from "../setup";
import Event from "@/models/event";

/**
 * `saveMany` writes only the events it can settle in one statement and hands the
 * rest back, so what matters is the split: which events land, which come back,
 * and whether the ids it reports as written match what was sent.
 */

const createdIds: {
  patients: string[];
  visits: string[];
  events: string[];
} = { patients: [], visits: [], events: [] };

const insertTestPatient = async () => {
  const id = uuidV1();
  createdIds.patients.push(id);
  await testDb
    .insertInto("patients")
    .values({
      id,
      given_name: "SaveMany",
      surname: "Patient",
      date_of_birth: sql`'1990-01-01'::date`,
      sex: "female",
      is_deleted: false,
      created_at: sql`now()`,
      updated_at: sql`now()`,
      last_modified: sql`now()`,
      server_created_at: sql`now()`,
      metadata: sql`'{}'::jsonb`,
    })
    .execute();
  return id;
};

const insertTestVisit = async (patientId: string) => {
  const id = uuidV1();
  createdIds.visits.push(id);
  await testDb
    .insertInto("visits")
    .values({
      id,
      patient_id: patientId,
      is_deleted: false,
      created_at: sql`now()`,
      updated_at: sql`now()`,
      last_modified: sql`now()`,
      server_created_at: sql`now()`,
      metadata: sql`'{}'::jsonb`,
    })
    .execute();
  return id;
};

const makeEvent = (
  patientId: string,
  visitId: string | null,
  overrides: Partial<Event.EncodedT> = {},
): Event.EncodedT => {
  const id = overrides.id ?? uuidV1();
  createdIds.events.push(id);
  const now = new Date();
  return {
    id,
    patient_id: patientId,
    visit_id: visitId,
    form_id: null,
    event_type: "test",
    form_data: [{ field: "original" }],
    metadata: {},
    is_deleted: false,
    created_at: now,
    updated_at: now,
    last_modified: now,
    server_created_at: now,
    deleted_at: null,
    recorded_by_user_id: null,
    ...overrides,
  };
};

const storedEvent = async (id: string) =>
  await testDb
    .selectFrom("events")
    .select(["id", "form_data"])
    .where("id", "=", id)
    .executeTakeFirst();

afterEach(async () => {
  for (const id of createdIds.events)
    await testDb.deleteFrom("events").where("id", "=", id).execute();
  for (const id of createdIds.visits)
    await testDb.deleteFrom("visits").where("id", "=", id).execute();
  for (const id of createdIds.patients)
    await testDb.deleteFrom("patients").where("id", "=", id).execute();
  createdIds.events.length = 0;
  createdIds.visits.length = 0;
  createdIds.patients.length = 0;
});

describe("Event.API.saveMany (integration)", () => {
  it("writes every event whose visit the database already holds", async () => {
    const patientId = await insertTestPatient();
    const visitId = await insertTestVisit(patientId);
    const events = [
      makeEvent(patientId, visitId),
      makeEvent(patientId, visitId),
      makeEvent(patientId, visitId),
    ];

    const result = await Event.API.saveMany(events);

    expect(result.deferred).toEqual([]);
    expect(new Set(result.acceptedIds)).toEqual(
      new Set(events.map((event) => event.id)),
    );
    for (const event of events) {
      expect(await storedEvent(event.id)).toBeDefined();
    }
  });

  it("hands back an event whose visit is missing, unwritten", async () => {
    const patientId = await insertTestPatient();
    const visitId = await insertTestVisit(patientId);
    const batchable = makeEvent(patientId, visitId);
    // A well-formed uuid that no visit row carries: `save` would mint a
    // fallback visit for it, which the batch path deliberately does not do.
    const orphan = makeEvent(patientId, uuidV1());

    const result = await Event.API.saveMany([batchable, orphan]);

    expect(result.acceptedIds).toEqual([batchable.id]);
    // Identity, not equality: the runner matches deferred entries by reference
    // to find what it still has to write one at a time.
    expect(result.deferred).toHaveLength(1);
    expect(result.deferred[0]).toBe(orphan);
    expect(await storedEvent(orphan.id)).toBeUndefined();
  });

  it("hands back a second event claiming an id already in the batch", async () => {
    const patientId = await insertTestPatient();
    const visitId = await insertTestVisit(patientId);
    const first = makeEvent(patientId, visitId);
    const duplicate = makeEvent(patientId, visitId, { id: first.id });

    const result = await Event.API.saveMany([first, duplicate]);

    expect(result.acceptedIds).toEqual([first.id]);
    expect(result.deferred).toHaveLength(1);
    expect(result.deferred[0]).toBe(duplicate);
  });

  it("reports a stale event as unwritten and leaves the stored row alone", async () => {
    const patientId = await insertTestPatient();
    const visitId = await insertTestVisit(patientId);
    const stored = makeEvent(patientId, visitId);
    await Event.API.saveMany([stored]);

    const stale = makeEvent(patientId, visitId, {
      id: stored.id,
      updated_at: new Date("2020-01-01T00:00:00Z"),
      form_data: [{ field: "stale" }],
    });
    const result = await Event.API.saveMany([stale]);

    expect(result.acceptedIds).toEqual([]);
    expect(result.deferred).toEqual([]);
    const row = await storedEvent(stored.id);
    expect(row?.form_data).toEqual([{ field: "original" }]);
  });

  it("writes a newer version of an event it already holds", async () => {
    const patientId = await insertTestPatient();
    const visitId = await insertTestVisit(patientId);
    const stored = makeEvent(patientId, visitId);
    await Event.API.saveMany([stored]);

    const newer = makeEvent(patientId, visitId, {
      id: stored.id,
      updated_at: new Date(Date.now() + 60_000),
      form_data: [{ field: "updated" }],
    });
    const result = await Event.API.saveMany([newer]);

    expect(result.acceptedIds).toEqual([stored.id]);
    const row = await storedEvent(stored.id);
    expect(row?.form_data).toEqual([{ field: "updated" }]);
  });
});
