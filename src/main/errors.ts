export class AppError extends Error {
  constructor(
    message: string,
    public code = "REQUEST_FAILED",
    public status?: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}
export function safeError(error: unknown): { message: string; code: string } {
  if (error instanceof AppError)
    return { message: error.message, code: error.code };
  return {
    message: "请求未完成，请稍后重试或检查连接状态。",
    code: "INTERNAL_ERROR",
  };
}
