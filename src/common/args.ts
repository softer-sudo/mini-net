export function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1 || idx === args.length - 1) return undefined;
  return args[idx + 1];
}

export function getFlagOrDefault(args: string[], name: string, fallback: string): string {
  return getFlag(args, name) ?? fallback;
}
