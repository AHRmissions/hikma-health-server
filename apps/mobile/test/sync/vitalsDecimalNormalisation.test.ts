/**
 * Postgres `decimal` columns reach the device as strings (`pg` registers no
 * numeric type parser), and `sanitizedRaw` nulls any non-number on a number
 * column. That combination silently emptied height, weight, BMI, waist,
 * oxygen saturation and temperature on every vitals row that had been synced,
 * while the `integer` columns beside them (BP, heart rate, pain level) survived.
 *
 * Asserted through `sanitizedRaw`, not on `updateDates` output alone — the
 * sanitizer is the boundary that was actually dropping the values.
 */

import { sanitizedRaw } from "@nozbe/watermelondb/RawRecord"

import schema from "@/db/schema"
import { updateDates } from "@/db/syncNormalize"

jest.mock("@sentry/react-native", () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}))

/** Verbatim shape of a `patient_vitals` row as the sync GET serialises it. */
const SERVER_PAGE = () => ({
  patient_vitals: {
    created: [
      {
        id: "01a075c0-ee76-7893-b62a-52d0c85bf96a",
        patient_id: "019f382c-f2bc-7927-9f59-d9ab1e50e766",
        visit_id: null,
        timestamp: "2026-09-06T08:06:13.297Z",
        // integer columns — pg parses these to JS numbers
        systolic_bp: 120,
        diastolic_bp: 80,
        heart_rate: 72,
        pulse_rate: 70,
        respiratory_rate: 16,
        pain_level: 3,
        bp_position: "sitting",
        // decimal columns — pg hands these over as strings
        height_cm: "170.00",
        weight_kg: "65.50",
        bmi: "22.66",
        waist_circumference_cm: "80.00",
        oxygen_saturation: "98.00",
        temperature_celsius: "36.60",
        recorded_by_user_id: "8366285f-5c9d-49b0-9161-16961d3a40e9",
        metadata: {},
        is_deleted: false,
        created_at: "2026-09-06T08:06:13.366Z",
        updated_at: "2026-09-06T08:08:19.641Z",
        deleted_at: null,
      },
    ],
    updated: [],
    deleted: [],
  },
})

describe("a synced patient_vitals row keeps its decimal readings", () => {
  it("survives updateDates + sanitizedRaw with every measurement intact", () => {
    const page = SERVER_PAGE() as any
    updateDates(page)

    const raw = sanitizedRaw(page.patient_vitals.created[0], schema.tables.patient_vitals) as any

    expect(raw.height_cm).toBe(170)
    expect(raw.weight_kg).toBe(65.5)
    expect(raw.bmi).toBe(22.66)
    expect(raw.waist_circumference_cm).toBe(80)
    expect(raw.oxygen_saturation).toBe(98)
    expect(raw.temperature_celsius).toBe(36.6)

    // The integer columns were never the problem; pin them so a fix here
    // cannot quietly break the half that already worked.
    expect(raw.systolic_bp).toBe(120)
    expect(raw.diastolic_bp).toBe(80)
    expect(raw.pain_level).toBe(3)
    expect(raw.timestamp).toBe(new Date("2026-09-06T08:06:13.297Z").getTime())
  })

  it("leaves a date string on a number column alone rather than reading its year", () => {
    // parseFloat("2026-09-06") is 2026; Number() is NaN. If the date pass ever
    // stops handling a column, it must arrive as null, not as the year.
    const page = {
      patient_vitals: {
        created: [{ id: "v2", timestamp: "not-a-date", height_cm: "2026-09-06" }],
        updated: [],
        deleted: [],
      },
    } as any
    updateDates(page)

    const raw = sanitizedRaw(page.patient_vitals.created[0], schema.tables.patient_vitals) as any
    expect(raw.height_cm).toBeNull()
  })

  it("does not turn an empty string into zero", () => {
    const page = {
      patient_vitals: {
        created: [{ id: "v3", timestamp: 1, weight_kg: "" }],
        updated: [],
        deleted: [],
      },
    } as any
    updateDates(page)

    const raw = sanitizedRaw(page.patient_vitals.created[0], schema.tables.patient_vitals) as any
    expect(raw.weight_kg).toBeNull()
  })

  it("leaves string columns untouched", () => {
    // `dosage_quantity` and `sale_price` are declared as strings on the device
    // precisely because they are Postgres decimals; coercing them would null
    // them through the same sanitizer, in the opposite direction.
    const page = {
      drug_catalogue: {
        created: [{ id: "d1", dosage_quantity: "500.0000", sale_price: "12.50" }],
        updated: [],
        deleted: [],
      },
    } as any
    updateDates(page)

    const raw = sanitizedRaw(page.drug_catalogue.created[0], schema.tables.drug_catalogue) as any
    expect(raw.dosage_quantity).toBe("500.0000")
    expect(raw.sale_price).toBe("12.50")
  })
})
