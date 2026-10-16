use serde::Serialize;
use std::sync::Mutex;
use sysinfo::System;

#[derive(Serialize, Clone)]
pub struct Vitals {
    pub cpu_percent: f32,
    // Retain the IPC field names; memory values are mebibytes (MiB).
    pub mem_used_mb: u64,
    pub mem_total_mb: u64,
    pub mem_percent: f32,
    pub load_1: f32,
}

static SYSTEM: Mutex<Option<System>> = Mutex::new(None);

fn bytes_to_mib(bytes: u64) -> u64 {
    bytes / (1024 * 1024)
}

#[tauri::command]
pub fn system_vitals() -> Vitals {
    let mut sys = match SYSTEM.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let sys = sys.get_or_insert_with(System::new_all);
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpu_percent = sys.global_cpu_usage();
    let mem_used = sys.used_memory();
    let mem_total = sys.total_memory();
    let mem_percent = if mem_total > 0 {
        (mem_used as f32 / mem_total as f32) * 100.0
    } else {
        0.0
    };

    // Load average is Unix-only; default to 0 on Windows
    #[cfg(unix)]
    let load_1 = System::load_average().one as f32;
    #[cfg(not(unix))]
    let load_1 = 0.0f32;

    Vitals {
        cpu_percent,
        mem_used_mb: bytes_to_mib(mem_used),
        mem_total_mb: bytes_to_mib(mem_total),
        mem_percent,
        load_1,
    }
}

#[cfg(test)]
mod tests {
    use super::bytes_to_mib;

    #[test]
    fn converts_sysinfo_bytes_to_mib_without_inflating_memory() {
        assert_eq!(bytes_to_mib(32 * 1024 * 1024 * 1024), 32_768);
        assert_eq!(bytes_to_mib(22 * 1024 * 1024 * 1024), 22_528);
    }

    #[test]
    fn handles_zero_and_truncates_partial_mib() {
        assert_eq!(bytes_to_mib(0), 0);
        assert_eq!(bytes_to_mib(1024 * 1024 - 1), 0);
        assert_eq!(bytes_to_mib(1024 * 1024 + 1024), 1);
        assert_eq!(bytes_to_mib(u64::MAX), u64::MAX / 1_048_576);
    }
}
