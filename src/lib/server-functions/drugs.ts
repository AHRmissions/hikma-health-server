import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import DrugCatalogue from "@/models/drug-catalogue";
import * as Sentry from "@sentry/tanstackstart-react";

export const saveDrug = createServerFn({ method: "POST" })
  .validator(
    (data: { drug: Partial<DrugCatalogue.ApiDrug>; isEdit: boolean }) => data,
  )
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: "Save drug to catalogue" }, async () => {
      const result = await Effect.runPromise(
        DrugCatalogue.API.upsert(data.drug).pipe(
          Effect.catchAll((error) => {
            Sentry.captureException(error);
            return Effect.fail({ status: 500, message: "Failed to save drug" });
          }),
        ),
      );
      return result;
    });
  });

export const getDrugById = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: "Get drug by id" }, async () => {
      const result = await Effect.runPromise(
        DrugCatalogue.API.getById(data.id).pipe(
          Effect.catchAll((error) => {
            Sentry.captureException(error);
            return Effect.fail(error);
          }),
        ),
      );
      return result;
    });
  });

export const getAllDrugs = createServerFn({ method: "GET" })
  .validator(
    (params: { limit?: number; offset?: number; isActive?: boolean }) => params,
  )
  .handler(async ({ data }) => {
    return Sentry.startSpan(
      { name: "Get all drugs from catalogue" },
      async () => {
        const result = await Effect.runPromise(
          DrugCatalogue.API.getAll({
            limit: data.limit ?? 100,
            offset: data.offset ?? 0,
            isActive: data.isActive,
          }).pipe(
            Effect.catchTag("ValidationError", () =>
              Effect.fail({ status: 400, message: "Invalid request" }),
            ),
            Effect.catchAll((error) => {
              Sentry.captureException(error);
              return Effect.fail({
                status: 500,
                message: "Internal server error",
              });
            }),
          ),
        );
        return result;
      },
    );
  });

export const searchDrugs = createServerFn({ method: "GET" })
  .validator(
    (params: { searchTerm: string; limit?: number; offset?: number }) => params,
  )
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: "Search drugs in catalogue" }, async () => {
      const result = await Effect.runPromise(
        DrugCatalogue.API.search({
          searchTerm: data.searchTerm,
          limit: data.limit ?? 100,
          offset: data.offset ?? 0,
        }).pipe(
          Effect.catchAll((error) => {
            Sentry.captureException(error);
            return Effect.succeed([]);
          }),
        ),
      );
      return result;
    });
  });

// Server function to get drug stats
export const getDrugStats = createServerFn({ method: "GET" }).handler(
  async () => {
    return Sentry.startSpan({ name: "Get drug catalogue stats" }, async () => {
      const stats = await Effect.runPromise(
        DrugCatalogue.API.getStats().pipe(
          Effect.catchAll((error) => {
            Sentry.captureException(error);
            return Effect.succeed({
              totalDrugs: 0,
              activeDrugs: 0,
              controlledDrugs: 0,
              refrigeratedDrugs: 0,
            });
          }),
        ),
      );
      return stats;
    });
  },
);
