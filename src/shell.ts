// Single-quote a string for safe use as a shell token.
// Escapes embedded single quotes as: ' → '\''
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
