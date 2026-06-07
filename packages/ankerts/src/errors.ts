/**
 * Typed errors (brief §3, §7). Every error the SDK throws carries a structured,
 * machine-parseable shape — code, transport, retriability, an actionable hint,
 * and the echoed input — and maps to a documented CLI exit code. The SDK never
 * writes to stderr or exits; it throws these and lets the CLI format + map them.
 */

export type Transport = "mqtt" | "pppp" | "https";

/** The structured body emitted as the JSON error and on stderr. */
export interface AnkerErrorBody {
  code: string;
  message: string;
  transport?: Transport;
  retriable: boolean;
  hint?: string;
  input?: Record<string, unknown>;
}

export interface AnkerErrorOptions {
  code: string;
  message: string;
  transport?: Transport;
  retriable?: boolean;
  hint?: string;
  input?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * Base class for all SDK errors. `exitCode` is the documented CLI contract:
 *
 * ```
 * 1  generic / unexpected      4  printer not found / not selected
 * 2  usage error               5  connectivity / timeout (RETRIABLE)
 * 3  auth error                6  transport unavailable for this op
 *                              7  printer-side error (gcode rejected, job refused)
 * ```
 */
export class AnkerError extends Error {
  readonly exitCode: number = 1;
  readonly code: string;
  readonly transport?: Transport;
  readonly retriable: boolean;
  readonly hint?: string;
  input?: Record<string, unknown>;

  constructor(opts: AnkerErrorOptions) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = new.target.name;
    this.code = opts.code;
    this.transport = opts.transport;
    this.retriable = opts.retriable ?? false;
    this.hint = opts.hint;
    this.input = opts.input;
  }

  /** Attach/merge the failing input (the CLI echoes this back). */
  withInput(input: Record<string, unknown>): this {
    this.input = { ...this.input, ...input };
    return this;
  }

  /** The structured body for JSON output and stderr. */
  body(): AnkerErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.transport ? { transport: this.transport } : {}),
      retriable: this.retriable,
      ...(this.hint ? { hint: this.hint } : {}),
      ...(this.input ? { input: this.input } : {}),
    };
  }

  toJSON(): { error: AnkerErrorBody } {
    return { error: this.body() };
  }
}

/** Exit 2 — bad/missing arguments. Thrown mostly at the CLI boundary. */
export class UsageError extends AnkerError {
  override readonly exitCode = 2;
  constructor(opts: Omit<AnkerErrorOptions, "code"> & { code?: string }) {
    super({ code: "usage", retriable: false, ...opts });
  }
}

/** Exit 3 — login required/expired/captcha. */
export class AuthError extends AnkerError {
  override readonly exitCode = 3;
  constructor(opts: Omit<AnkerErrorOptions, "code"> & { code?: string }) {
    super({ code: "auth_required", transport: "https", retriable: false, ...opts });
  }
}

/** Exit 4 — printer not found on the account / none selected. */
export class PrinterNotFoundError extends AnkerError {
  override readonly exitCode = 4;
  constructor(opts: Omit<AnkerErrorOptions, "code"> & { code?: string }) {
    super({ code: "printer_not_found", retriable: false, ...opts });
  }
}

/** Exit 5 — connectivity/timeout. Always retriable (transient). */
export class TimeoutError extends AnkerError {
  override readonly exitCode = 5;
  constructor(opts: Omit<AnkerErrorOptions, "code" | "retriable"> & { code?: string }) {
    super({ code: "timeout", retriable: true, ...opts });
  }
}

/** Exit 6 — the chosen op needs a transport the printer isn't reachable on. */
export class TransportUnavailableError extends AnkerError {
  override readonly exitCode = 6;
  constructor(opts: Omit<AnkerErrorOptions, "code"> & { code?: string }) {
    super({ code: "transport_unavailable", retriable: false, ...opts });
  }
}

/** Exit 7 — the printer rejected the request (gcode/job refused). */
export class PrinterRejectedError extends AnkerError {
  override readonly exitCode = 7;
  constructor(opts: Omit<AnkerErrorOptions, "code"> & { code?: string }) {
    super({ code: "printer_rejected", retriable: false, ...opts });
  }
}

/** Map any thrown value to an {@link AnkerError} (wrapping unknowns as exit 1). */
export function toAnkerError(err: unknown): AnkerError {
  if (err instanceof AnkerError) return err;
  if (err instanceof Error) {
    return new AnkerError({ code: "internal_error", message: err.message, cause: err });
  }
  return new AnkerError({ code: "internal_error", message: String(err) });
}
