/** Client address for quota counting: the first entry of x-forwarded-for, else x-real-ip, else "unknown". */
export function getClientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
