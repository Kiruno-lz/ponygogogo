export class AssetLoadError extends Error {
  constructor(readonly code: string, readonly values: Record<string, string | number>) {
    super(code)
  }
}

export function assetFailure(error: unknown) {
  return {
    message: error instanceof Error ? error.message : String(error),
    issue: error instanceof AssetLoadError ? { code: error.code, values: error.values } : undefined,
  }
}
