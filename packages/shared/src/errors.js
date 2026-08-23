class AppError extends Error {
  constructor(message, code = "APP_ERROR", statusCode = 500, details = null) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, "VALIDATION_ERROR", 400, details);
    this.name = "ValidationError";
  }
}
class NotFoundError extends AppError {
  constructor(message, details = null) {
    super(message, "NOT_FOUND", 404, details);
    this.name = "NotFoundError";
  }
}
class ConflictError extends AppError {
  constructor(message, details = null) {
    super(message, "CONFLICT", 409, details);
    this.name = "ConflictError";
  }
}
class ForbiddenError extends AppError {
  constructor(message, details = null) {
    super(message, "FORBIDDEN", 403, details);
    this.name = "ForbiddenError";
  }
}
module.exports = { AppError, ValidationError, NotFoundError, ConflictError, ForbiddenError };
