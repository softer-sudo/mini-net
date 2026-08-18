#!/usr/bin/env node

const USAGE = `mini-net -- tiny networking fundamentals CLI

Usage:
  mini-net <command> [options]

Commands:
  tcp-chat server --port <n>
  tcp-chat client --host <h> --port <n>
  udp-messenger server --port <n>
  udp-messenger client --host <h> --port <n>
  tls-chat server --port <n>
  tls-chat client --host <h> --port <n>
  dns lookup <hostname>
  dns raw <hostname> [--server <ip>]
  ping <host> [--port <n>] [--count <n>]
  traceroute <host> [--port <n>]

See README.md for full details and examples.
`;

type CommandHandler = (args: string[]) => Promise<void> | void;

const commands = new Map<string, CommandHandler>();

export function registerCommand(name: string, handler: CommandHandler): void {
  commands.set(name, handler);
}

export async function run(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command) {
    process.stdout.write(USAGE);
    return 1;
  }
  if (command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }

  const handler = commands.get(command);
  if (!handler) {
    process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
    return 1;
  }

  await handler(rest);
  return 0;
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
