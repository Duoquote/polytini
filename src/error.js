// The error type every entry point and subpath throws. Its own module, so
// subpaths that only need the error (like /flexible) don't pull in the
// Google-format code.
export class PolylineError extends Error {
  constructor(code, message, index) {
    super(index == null ? message : message + ' at ' + index);
    this.name = 'PolylineError';
    this.code = code;
    this.index = index;
  }
}

export const fail = (code, message, index) => {
  throw new PolylineError(code, message, index);
};

// Strict mode throws. Lenient mode hands the same error to onIssue, when
// there is one, and goes on. Only the slow decoders call this, so the fast
// loops pay nothing for it.
export const issue = (strict, on, code, message, index) => {
  if (strict) fail(code, message, index);
  if (on) on(new PolylineError(code, message, index));
};
