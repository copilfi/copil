/**
 * Error Handling Types - Clean Code: Explicit Error Types
 * Standardizes error handling across the application
 */

export interface AppError {
  message: string;
  code?: string;
  details?: any;
}

export interface DatabaseError extends AppError {
  type: 'database';
  query?: string;
}

export interface ExternalApiError extends AppError {
  type: 'external_api';
  source: string;
  statusCode?: number;
}

export interface ValidationError extends AppError {
  type: 'validation';
  field?: string;
}

export type StrategyError = DatabaseError | ExternalApiError | ValidationError;

/**
 * Type Guard Functions - Clean Code: Type Safety
 */
export function isDatabaseError(error: unknown): error is DatabaseError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as DatabaseError).type === 'database'
  );
}

export function isExternalApiError(error: unknown): error is ExternalApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as ExternalApiError).type === 'external_api'
  );
}

export function isValidationError(error: unknown): error is ValidationError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as ValidationError).type === 'validation'
  );
}
