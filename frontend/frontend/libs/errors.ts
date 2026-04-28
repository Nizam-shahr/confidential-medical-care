// Safely extract a message from an unknown error
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    // ethers errors often have a `reason` property
    const reason = (err as Error & { reason?: string }).reason;
    return reason || err.message;
  }
  return String(err);
}