/**
 * Контракт AGT-006a из task/AGT-006 (crates/qubite-server/src/routes.rs).
 * Дополнение до генерации OpenAPI в CI: schema.ts вручную не меняем.
 */
import type { components } from './schema';

export interface RoutePoint {
  lat: number;
  lon: number;
}

export interface TaskRouteResponse {
  minutes: number;
  meters: number;
  geometry: RoutePoint[];
  place_text: string | null;
  to: RoutePoint;
  provider: string;
  attribution: string;
}

type JsonResponse<T> = {
  headers: { [name: string]: unknown };
  content: { 'application/json': T };
};

export interface PlannerRoutePaths {
  '/api/v1/planner/tasks/{id}/route': {
    post: {
      parameters: { path: { id: string } };
      requestBody: { content: { 'application/json': { from: RoutePoint } } };
      responses: {
        200: JsonResponse<TaskRouteResponse>;
        400: JsonResponse<components['schemas']['ApiErrorBody']>;
        401: JsonResponse<components['schemas']['ApiErrorBody']>;
        403: JsonResponse<components['schemas']['ApiErrorBody']>;
        404: JsonResponse<components['schemas']['ApiErrorBody']>;
        409: JsonResponse<components['schemas']['ApiErrorBody']>;
        503: JsonResponse<components['schemas']['ApiErrorBody']>;
      };
    };
  };
}
