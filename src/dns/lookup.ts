import dns from 'node:dns/promises';

export interface LookupResult {
  hostname: string;
  addresses: string[];
}

export async function lookupHostname(hostname: string): Promise<LookupResult> {
  const addresses = await dns.resolve4(hostname);
  return { hostname, addresses };
}

export async function runLookupCommand(args: string[]): Promise<void> {
  const [hostname] = args;
  if (!hostname) {
    console.error('Usage: mini-net dns lookup <hostname>');
    return;
  }
  const result = await lookupHostname(hostname);
  console.log(`${result.hostname} -> ${result.addresses.join(', ')}`);
}
