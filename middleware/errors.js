'use strict';

class ApiError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail === undefined ? {} : detail;
  }
}

const errors = {
  validation(message, detail) {
    return new ApiError(400, 'VALIDATION_ERROR', message, detail);
  },
  authenticationRequired(detail) {
    return new ApiError(
      401,
      'AUTHENTICATION_REQUIRED',
      'A bearer token is required to access this resource',
      detail
    );
  },
  invalidToken(detail) {
    return new ApiError(401, 'INVALID_TOKEN', 'The bearer token is invalid or has expired', detail);
  },
  insufficientScope(requiredScope, tokenScope) {
    return new ApiError(403, 'INSUFFICIENT_SCOPE', `This endpoint requires the '${requiredScope}' scope`, {
      required_scope: requiredScope,
      token_scope: tokenScope === undefined ? null : tokenScope,
    });
  },
  jurisdictionForbidden(message, detail) {
    return new ApiError(403, 'JURISDICTION_FORBIDDEN', message, detail);
  },
  forbidden(message, detail) {
    return new ApiError(403, 'FORBIDDEN', message, detail);
  },
  installationIdMismatch(expected, received) {
    return new ApiError(403, 'FORBIDDEN', 'Installation ID mismatch', {
      expected,
      received,
    });
  },
  notFound(message, detail) {
    return new ApiError(404, 'RESOURCE_NOT_FOUND', message, detail);
  },
  duplicateReading(detail) {
    return new ApiError(
      409,
      'DUPLICATE_READING',
      'A reading already exists for this solar installation at the supplied timestamp',
      detail
    );
  },
  internal(detail) {
    return new ApiError(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred while processing the request',
      detail
    );
  },
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normaliseDetail(detail) {
  if (isPlainObject(detail)) {
    return detail;
  }
  if (detail === undefined || detail === null) {
    return {};
  }
  return { value: detail };
}

function translateExpressError(error) {
  if (error.type === 'entity.parse.failed') {
    return errors.validation('The request body is not valid JSON', {
      received: typeof error.body === 'string' ? error.body.slice(0, 120) : null,
    });
  }
  if (error.type === 'entity.too.large') {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The request body exceeds the permitted size', {});
  }
  if (error.type === 'encoding.unsupported' || error.type === 'charset.unsupported') {
    return new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported request body encoding', {});
  }
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
    return errors.validation(error.message, {});
  }
  return null;
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  let resolved = error instanceof ApiError ? error : translateExpressError(error);
  if (resolved === null) {
    resolved = errors.internal({ method: req.method, path: req.originalUrl });
  }

  if (resolved.status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, error);
  }

  res.status(resolved.status).json({
    code: resolved.code,
    message: resolved.message,
    detail: normaliseDetail(resolved.detail),
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    code: 'RESOURCE_NOT_FOUND',
    message: `No resource matches ${req.method} ${req.originalUrl}`,
    detail: { method: req.method, path: req.originalUrl },
  });
}

module.exports = { ApiError, errors, errorHandler, notFoundHandler };
