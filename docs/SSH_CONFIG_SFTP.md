# SSH-config aliases and SFTP

Saved connections have two modes:

- **Use SSH config**: terminal SSH launches the alias without overriding its port, user or authentication. SFTP resolves supported local configuration for the same alias. Remotes and the connection editor display the resolved hostname, username and port, not the old placeholder `22`. Refresh Remotes or SFTP connection details after editing local config.
- **Manual settings**: the saved port/user and selected authentication method apply to SFTP. Terminal SSH receives the explicit saved port (including `22`), user and any selected key or jump host; OpenSSH still governs authentication.

New imports use SSH config. Untouched legacy imports are recognized by the original `ssh-config` tag, blank user, port `22`, agent auth and absence of custom key, jump host or credentials. Customized profiles retain their saved settings. An explicit manual choice always wins over legacy detection.

## Preview and authentication

Opening the preview reads bounded local SSH-config metadata only. It does not start SSH, run `Match exec`, contact a server, query the agent or read private-key contents. If config cannot be safely resolved, it reports why and does not invent a port. The reviewed resolved target is checked again before connecting; changed settings require a refresh and another review.

**Connect & browse** explicitly opens a separate SSH/SFTP session and lists its starting folder. It does not reuse a terminal session, terminal-only environment, sudo privileges or its current directory. It does not upload, sync, or share files with AI automatically. Existing host-key verification remains required; unknown fingerprints require independent user verification, and changed known keys remain blocked.

- **SSH agent**: no password/passphrase box; uses the agent available to the app.
- **Private key**: optional transient key passphrase, not saved by the SFTP panel.
- **SSH config**: tries the app agent and supported identity files. Use **Use an encrypted key…** only when a file needs a passphrase.
- **Password**: asks for a transient server password only when explicitly selected.

## Algorithm compatibility

SFTP supports `KexAlgorithms`, `Ciphers`, `MACs` and `HostKeyAlgorithms` for algorithms implemented by its russh backend. Comma-separated replacement lists and `+` append, `^` prepend and `-` removal are supported; removal accepts `*`/`?` patterns. Modifier semantics follow the [OpenSSH manual](https://man.openbsd.org/ssh_config.5#KexAlgorithms), but the starting defaults are **russh's**, which can differ from OpenSSH's defaults. Protocol extension and strict-KEX markers are retained separately from the selectable KEX list.

Unsupported requested algorithms, malformed lists and policies leaving no supported algorithms are rejected before connecting. The backend never drops a policy to retry with defaults. Cleartext/pseudo-algorithm enablement is not permitted.

This is not complete OpenSSH compatibility. Proxy/jump routes, `Match`, unsupported certificate/security-key policies, `CASignatureAlgorithms`, `RequiredRSASize` and `RekeyLimit` still fail closed. `IdentitiesOnly yes` is not silently bypassed for unfiltered agent/automatic authentication. Use terminal OpenSSH for configurations the SFTP backend cannot enforce; do not remove security restrictions merely to make the browser connect.

## Validation

Automated frontend tests cover legacy profile recognition, explicit overrides, imported alias launching, resolved UI labels, credential fields, preview failure/refresh and stale replies. Native fixture tests cover config resolution, policy order/removal, unsupported algorithms, policy-bound confirmation and connection cancellation. They do not connect to real servers or use personal SSH config/private keys.

Optional live check, only on a host you authorize:

1. Open an imported alias with a non-default port. Confirm Remotes, Edit Connection and Browse remote files show the configured destination and inherited mode.
2. Opening these views must not log in. Agent mode must not ask for a password/passphrase.
3. Connect explicitly, independently verify any unknown fingerprint, and confirm the directory listing. Do not approve a changed key without investigating it.
4. Change the alias configuration after previewing. Connect should refuse the stale preview; refresh and review again.
5. Verify an unsupported SSH policy reports a specific error without attempting a connection.
