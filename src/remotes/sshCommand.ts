import { shq } from "../lib/shellQuote";
import { connectionInheritsSshConfig, type SshConnection } from "../remote/connectionManager";

export function sshCommandForConnection(connection: SshConnection): string {
  if (connectionInheritsSshConfig(connection)) return `ssh ${shq(connection.host)}`;
  const args = ["ssh", "-p", String(connection.port)];
  if (connection.authType === "key" && connection.privateKeyPath) {
    args.push("-i", shq(connection.privateKeyPath));
  }
  if (connection.jumpHost) args.push("-J", shq(connection.jumpHost));
  const target = connection.user ? `${connection.user}@${connection.host}` : connection.host;
  args.push(shq(target));
  return args.join(" ");
}

export function sshConnectionAddress(connection: SshConnection): string {
  if (connectionInheritsSshConfig(connection)) return connection.host;
  const target = connection.user ? `${connection.user}@${connection.host}` : connection.host;
  return connection.port === 22 ? target : `${target}:${connection.port}`;
}
