//! Local TCP listener inspection for the Ports utility.
//!
//! This deliberately uses `lsof` rather than a shell pipeline. The executable
//! is resolved through Husk's safe binary resolver, and both its arguments and
//! the PID accepted by `ports_stop` are structured values — no user-provided
//! text is ever interpreted by a shell.

use std::collections::HashSet;
use std::process::Command;

use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct PortListener {
    pub port: u16,
    pub pid: u32,
    pub command: String,
    pub address: String,
}

fn parse_listener_name(value: &str) -> Option<(String, u16)> {
    // lsof reports names such as `127.0.0.1:5173`, `*:3000`, and `[::1]:8080`.
    // Take only a numeric final segment; that naturally ignores non-TCP names.
    let (address, port) = value.rsplit_once(':')?;
    let port = port.trim().parse::<u16>().ok()?;
    Some((address.trim().to_string(), port))
}

fn parse_lsof_listeners(output: &str) -> Vec<PortListener> {
    let mut listeners = Vec::new();
    let mut seen = HashSet::new();
    let mut pid: Option<u32> = None;
    let mut command = String::new();

    // `-Fpcn` is a stable, field-prefixed lsof output format. A process record
    // may carry several name records, one for each listener it owns.
    for line in output.lines() {
        let Some((field, value)) = line
            .chars()
            .next()
            .map(|field| (field, &line[field.len_utf8()..]))
        else {
            continue;
        };
        match field {
            'p' => pid = value.trim().parse::<u32>().ok(),
            'c' => command = value.trim().to_string(),
            'n' => {
                let Some(pid) = pid else { continue };
                let Some((address, port)) = parse_listener_name(value) else {
                    continue;
                };
                let key = (pid, port, address.clone());
                if seen.insert(key) {
                    listeners.push(PortListener {
                        port,
                        pid,
                        command: if command.is_empty() {
                            "unknown".to_string()
                        } else {
                            command.clone()
                        },
                        address,
                    });
                }
            }
            _ => {}
        }
    }

    listeners.sort_by(|a, b| a.port.cmp(&b.port).then_with(|| a.pid.cmp(&b.pid)));
    listeners
}

#[tauri::command]
pub fn ports_list() -> Result<Vec<PortListener>, String> {
    let lsof = crate::shell::validate_program("lsof")
        .map_err(|_| "lsof is not available. Install it to inspect local ports.".to_string())?;
    let output = Command::new(lsof)
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"])
        .output()
        .map_err(|error| format!("Could not inspect local ports: {error}"))?;

    // `lsof` uses a non-zero status when there are no matching rows. Its output
    // is still authoritative, so only surface an error if it actually reports
    // one on stderr.
    if !output.status.success() && !output.stderr.is_empty() {
        return Err(format!(
            "Could not inspect local ports: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(parse_lsof_listeners(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

#[tauri::command]
pub fn ports_stop(pid: u32, port: u16) -> Result<(), String> {
    // Signal 0/1 is never a meaningful user process and would be dangerous.
    if pid <= 1 {
        return Err("Refusing to stop a protected system process".to_string());
    }
    // Re-check immediately before signalling. Apart from giving a clearer
    // message when a dev server has already exited, this avoids acting on a
    // recycled PID that no longer owns the port the user selected.
    if !ports_list()?
        .iter()
        .any(|listener| listener.pid == pid && listener.port == port)
    {
        return Err(format!(
            "Process {pid} is no longer listening on port {port}. Refresh and try again."
        ));
    }

    #[cfg(unix)]
    {
        // SIGTERM lets normal development servers flush state and exit cleanly.
        // The operating system enforces ownership; another user's process is
        // rejected rather than elevated by Husk.
        let result = unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
        if result == 0 {
            Ok(())
        } else {
            Err(format!(
                "Could not stop process {pid}: {}",
                std::io::Error::last_os_error()
            ))
        }
    }

    #[cfg(not(unix))]
    {
        let _ = (pid, port);
        Err("Stopping local processes is currently available on macOS and Linux.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_sorts_lsof_listener_records() {
        let rows = parse_lsof_listeners(
            "p900\ncnode\nn*:5173\nn127.0.0.1:4173\np48\ncdnsmasq\nn[::1]:53\n",
        );
        assert_eq!(
            rows,
            vec![
                PortListener {
                    port: 53,
                    pid: 48,
                    command: "dnsmasq".to_string(),
                    address: "[::1]".to_string()
                },
                PortListener {
                    port: 4173,
                    pid: 900,
                    command: "node".to_string(),
                    address: "127.0.0.1".to_string()
                },
                PortListener {
                    port: 5173,
                    pid: 900,
                    command: "node".to_string(),
                    address: "*".to_string()
                },
            ]
        );
    }

    #[test]
    fn ignores_non_listener_or_malformed_rows() {
        let rows =
            parse_lsof_listeners("p42\ncnode\nnlocalhost:not-a-port\nnpipe\npbad\nn*:3000\n");
        assert!(rows.is_empty());
    }
}
