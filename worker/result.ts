export type Result<Success extends object | void, ErrorCode extends string> =
  | ([Success] extends [void] ? { ok: true } : { ok: true } & Success)
  | { ok: false; error: ErrorCode };

export type ErrorResultOf<Operation> = Operation extends (...args: never[]) => infer OperationResult
  ? Extract<Awaited<OperationResult>, { ok: false }>
  : never;
