# mini-net

A tiny Node.js + TypeScript CLI demonstrating networking fundamentals — TCP,
UDP, TLS, DNS, and latency — using only Node's built-in `net`, `dgram`,
`tls`, `dns`, and `child_process`. No runtime dependencies, no CLI
framework, no production-grade anything: each sub-command is a small,
self-contained example of one networking concept.

## Quick start

```bash
npm install
npm run gen-cert    # self-signed TLS cert for tls-chat (needs system openssl)
npm run build
npm test
```

```console
$ node dist/cli.js dns lookup github.com
github.com -> 140.82.121.4

$ node dist/cli.js ping github.com --port 443 --count 3
attempt 1: connected to github.com:443 in 35.2ms
attempt 2: connected to github.com:443 in 25.4ms
attempt 3: connected to github.com:443 in 25.0ms
rtt min/avg/max = 25.0/28.5/35.2 ms, 0/3 lost
```

The chat commands need two terminals — a server and a client:

```console
$ node dist/cli.js tcp-chat server --port 4123
$ node dist/cli.js tcp-chat client --host localhost --port 4123
```

## Commands

| Command | Demonstrates |
|---|---|
| `tcp-chat server` / `client` | Multi-client broadcast chat over TCP |
| `udp-messenger server` / `client` | Connectionless UDP relay |
| `tls-chat server` / `client` | Same chat, encrypted + certificate-verified |
| `dns lookup <host>` | Resolution via Node's built-in stub resolver |
| `dns raw <host> [--server <ip>]` | Hand-encoded DNS-over-UDP, no library help |
| `ping <host> [--port] [--count]` | RTT via TCP-connect (not ICMP echo) |
| `traceroute <host>` | TCP-connect RTT + OS-level hop count |

Defaults: ports `4000`/`5000`/`4443`, `--host localhost`, `dns raw --server`
defaults to `8.8.8.8`, `ping`/`traceroute --port` defaults to `80`. Every
server broadcasts to each *other* connected client — never back to the
sender.

## Key concepts

**OSI layers.** `tcp-chat`/`udp-messenger` sit at Transport (L4) over IP
(L3). `tls-chat` adds Session/Presentation (L5/L6) — the TLS handshake — on
top of TCP. `dns` is Application (L7) riding directly on a UDP datagram.
`ping`/`traceroute` conceptually belong at L3 (ICMP), but Node has no
raw-socket access without root, so they're approximated: TCP-connect timing
for RTT, and shelling out to the OS's `traceroute` for hop count.

**TCP vs UDP.** TCP is connection-oriented, ordered, and reliable — a
handshake, then sequenced and acknowledged bytes. UDP is connectionless and
best-effort — one datagram, no delivery guarantee. The chat commands use
TCP because message order and delivery matter; `udp-messenger` and
`dns raw` use UDP because each is one self-contained request/response, and
any reliability that's needed (like DNS's "did I get a reply") is handled
by the application's own timeout instead.

**DNS.** A lookup is a chain: stub resolver → recursive resolver → root →
TLD → authoritative server. `dns lookup` uses Node's `dns.resolve4()`,
which hands that whole chain to a configured recursive resolver (e.g.
`8.8.8.8`) and gets back one final answer. `dns raw` shows the wire format
directly: one hand-encoded UDP packet out, one back, decoded byte-by-byte —
including DNS's name-compression pointers.

**TLS handshake.** `tls-chat` runs the exact same protocol as `tcp-chat`,
over `node:tls`. Client and server negotiate a cipher, the server presents
a certificate, the client validates it, and both sides derive a shared
session key for everything after. This project **pins its self-signed CA**
(`certs/server.cert`) rather than disabling verification —
`rejectUnauthorized` stays at its safe default of `true`.

**Bandwidth, hops, and CDNs.** Round-trip time is dominated by propagation
and per-hop delay, which grow with distance/hop count — exactly what
`traceroute` measures. Bandwidth mostly affects how long a large transfer
takes, not how fast the first byte arrives. CDNs cut response time mainly
by shortening that distance (an edge server near the client) and by
caching, which skips the round trip to origin entirely.

## The vulnerability mitigated

`tcp-chat`/`tls-chat` buffer incoming bytes until a newline. Without a
bound, a client that never sends `\n` can grow that buffer forever — a
memory-exhaustion DoS. `src/common/line-framer.ts`'s `LineFramer` caps any
unterminated or oversized line at `MAX_LINE_BYTES` (1024 bytes) and
disconnects the client once it's exceeded. This guards specifically against
that one pattern — it is **not** a defense against SYN floods or a
distributed flood of many individually well-behaved connections, which
need different mitigations entirely.

## Project layout

```
mini-net/
├── scripts/gen-cert.sh   # self-signed TLS cert (npm run gen-cert)
├── test/                 # node:test suite (npm test)
└── src/
    ├── cli.ts             # command dispatcher
    ├── common/            # line-framer (anti-DoS), args, stdin-relay
    ├── tcp-chat/, tls-chat/, udp-messenger/  # server + client per protocol
    ├── dns/               # lookup.ts (built-in) + raw-query.ts (hand-rolled)
    └── latency/           # tcp-ping.ts + traceroute.ts
```
