# mini-net — design spec

Date: 2026-08-18
Status: approved

## Purpose

A tiny, single-purpose Node.js + TypeScript CLI that demonstrates networking
fundamentals using only Node built-ins (`net`, `dgram`, `tls`, `dns`,
`child_process`). Each sub-command is a self-contained, minimal example —
not a production framework.

## Non-goals

- No production-grade chat server (no auth, no persistence, no rooms).
- No real ICMP-based traceroute (Node has no raw-socket API without root /
  native addons) — hop count comes from shelling out to the OS tool.
- No CLI framework dependency (commander, yargs) — manual `process.argv`
  parsing.
- No test framework (vitest/jest) — one small smoke-test script instead.

## Decisions locked in brainstorming

| Decision | Choice |
|---|---|
| TLS cert generation | `scripts/gen-cert.sh` shells out to system `openssl` (setup step, not a runtime dependency) |
| Hop measurement | Our own TCP-connect RTT ping (`net` timing) + OS `traceroute`/`tracert` via `child_process` for hop count |
| Chat topology | Multi-client broadcast room (not 1:1) |
| Featured vulnerability | Unbounded input → memory-exhaustion DoS via unterminated/huge line |
| Module system | ESM (`"type": "module"`), `moduleResolution: NodeNext`, target ES2022 |
| Node version | `engines.node >= 18` |
| Package manager | npm |

## Architecture

```
mini-net/
├── package.json, tsconfig.json, README.md, .gitignore
├── scripts/
│   ├── gen-cert.sh          # openssl self-signed cert + key → certs/ (gitignored)
│   └── smoke-test.ts        # spawns each server, drives it with our own client code
├── certs/                   # generated, gitignored
└── src/
    ├── cli.ts               # entry point, dispatches sub-commands, --help
    ├── common/
    │   └── line-framer.ts   # bounded newline-delimited framing (the anti-DoS guard)
    ├── tcp-chat/{server,client}.ts
    ├── udp-messenger/{server,client}.ts
    ├── tls-chat/{server,client}.ts
    ├── dns/
    │   ├── lookup.ts         # wraps built-in `dns` (resolve4/resolve6/mx)
    │   └── raw-query.ts      # hand-rolled DNS-over-UDP query/response via `dgram`
    └── latency/
        ├── tcp-ping.ts        # RTT via net.connect() timing, min/avg/max
        └── traceroute.ts      # tcp-ping RTT + child_process OS traceroute/tracert for hops
```

## Components

### `common/line-framer.ts` — the security-relevant piece
Wraps a socket-like stream. Buffers incoming bytes until `\n`. If the buffer
exceeds `MAX_LINE_BYTES` (1024) without a delimiter, it best-effort writes an
error line to the peer, then destroys the socket and logs the reason. This is
the mitigation for the featured vulnerability (unbounded buffering →
memory-exhaustion DoS) and is shared by `tcp-chat` and `tls-chat` (same
line-oriented protocol; TLS is the same protocol over an encrypted socket).
Scope note (goes in README too): this guards specifically against
unterminated/oversized-line buffering, not SYN floods or distributed UDP
floods.

### `tcp-chat`
Server keeps a `Set<net.Socket>`, broadcasts each framed line to all other
connected sockets. Explicit handlers for `connect` (client), `timeout` (via
`socket.setTimeout()`), `close`, `error` on both ends — no unhandled socket
errors.

### `udp-messenger`
Client uses dgram **connected mode** (`socket.connect(port, host)`) to get a
`connect` event and OS-delivered `error` (e.g. `ECONNREFUSED` on port
unreachable). No built-in timeout on dgram, so a manual idle `setTimeout` is
added and cleared appropriately.

### `tls-chat`
Same line-framer protocol as `tcp-chat`, over `tls.createServer` /
`tls.connect`. Client keeps `rejectUnauthorized: true` (default) and pins the
CA via `ca: fs.readFileSync(certPath)` instead of disabling verification —
this is the realistic trust model for a self-signed cert. `gen-cert.sh` must
set `subjectAltName=DNS:localhost,IP:127.0.0.1` or modern Node rejects the
cert with `ERR_TLS_CERT_ALTNAME_INVALID` (Node ignores CN, requires SAN).

### `dns/lookup.ts`
Thin wrapper over built-in `dns.resolve4` / `resolve6` / `resolveMx` — the
"normal" way a developer resolves names.

### `dns/raw-query.ts`
Hand-encodes a DNS query (header + single question, QTYPE=A, QCLASS=IN),
sends it over a `dgram` socket to a resolver (default `8.8.8.8:53`), and
parses the raw response: header counts, skips the question section, then
walks the answer section (handling both label sequences and 0xC0
compression pointers) picking the **first record with TYPE=A**, skipping
CNAMEs. A `setTimeout` rejects if no reply arrives — demonstrates DNS is
"just a UDP request/response" at the wire level, plus the timeout-handling
theme of the whole project.

### `latency/tcp-ping.ts`
Runs N TCP connect attempts to `host:port` (default port 80), times
`connect()`→`'connect'` event per attempt, prints per-attempt RTT plus
min/avg/max. Documented in README as measuring **TCP handshake RTT**, not
ICMP echo — intentionally different from system `ping`.

### `latency/traceroute.ts`
Combines `tcp-ping` RTT output with hop count from shelling out to
`traceroute` (macOS/Linux) or `tracert` (Windows), selected via
`os.platform()`. Handles `ENOENT` (tool not installed) with a clear message
instead of crashing, and applies a timeout to the child process since
traceroute can hang on unresponsive hops.

## Error handling (cross-cutting)

Every socket (`net`, `tls`, `dgram`) gets an `error` listener (never let one
crash the process), a `close` log line, and explicit timeout handling
(`setTimeout` for TCP/TLS, manual timer for UDP). This consistency is itself
part of what the project demonstrates.

## Testing

`scripts/smoke-test.ts` (run via `tsx`, no test framework): for each of
tcp-chat / udp-messenger / tls-chat, spawns the server, connects with the
project's own client code, sends a normal message (assert it's echoed/
broadcast) and an intentionally oversized unterminated line (assert the
connection is destroyed by the line-framer guard) — this is the mitigation
demonstrated live, not just asserted in prose.

## README scope

Maps each sub-command to OSI layers (dgram/net/tls → L3/L4, dns → L7 running
over UDP/L4, latency tools → L3/ICMP-adjacent-but-emulated), explains TCP vs
UDP trade-offs, the TLS handshake, DNS resolution flow, and how bandwidth /
hop count / CDNs affect perceived response time. Explicitly documents the
line-framer guard as the mitigated vulnerability and states its scope limit
(not a general DoS/flood defense).
