/** Errores de dominio: se traducen a mensajes de interfaz, nunca a stack traces. */
export class AppError extends Error {
  readonly code: string;
  constructor(message: string, code = 'APP_ERROR') {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export class AuthError extends AppError {
  constructor(message = 'Debes iniciar sesión para continuar.') {
    super(message, 'UNAUTHENTICATED');
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'No tienes permisos para realizar esta acción.') {
    super(message, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'El registro no existe o fue eliminado.') {
    super(message, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

/** Regla de negocio violada (por ejemplo, una transición de turno inválida). */
export class RuleError extends AppError {
  constructor(message: string) {
    super(message, 'RULE_VIOLATION');
    this.name = 'RuleError';
  }
}

export class ValidationError extends AppError {
  readonly fieldErrors: Record<string, string[]>;
  constructor(
    fieldErrors: Record<string, string[]>,
    message = 'Revisa los datos ingresados.',
  ) {
    super(message, 'VALIDATION');
    this.name = 'ValidationError';
    this.fieldErrors = fieldErrors;
  }
}
