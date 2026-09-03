import { shq } from "../lib/shellQuote";
import type { SshConnection } from "../remote/connectionManager";

export function sshCommandForConnection(connection: SshConnection): string {
  const args = ["ssh"];
  if (connection.port !== 22) args.push("-p", String(connection.port));
  if (connection.authType === "key" && connection.privateKeyPath) {
    args.push("-i", shq(connection.privateKeyPath));
  }
  if (connection.jumpHost) args.push("-J", shq(connection.jumpHost));
  const target = connection.user ? `${connection.user}@${connection.host}` : connection.host;
  args.push(shq(target));
  return args.join(" ");
}

export function sshConnectionAddress(connection: SshConnection): string {
  const target = connection.user ? `${connection.user}@${connection.host}` : connection.host;
  return connection.port === 22 ? target : `${target}:${connection.port}`;
}
