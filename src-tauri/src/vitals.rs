use serde::Serialize;
use std::sync::Mutex;
use sysinfo::System;

#[derive(Serialize, Clone)]
pub struct Vitals {
    pub cpu_percent: f32,
    pub mem_used_mb: u64,
    pub mem_total_mb: u64,
    pub mem_percent: f32,
    pub load_1: f32,
}

static SYSTEM: Mutex<Option<System>> = Mutex::new(None);

#[tauri::command]
pub fn system_vitals() -> Vitals {
    let mut lock = SYSTEM.lock().unwrap();
    let sys = lock.get_or_insert_with(System::new_all);
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
        mem_used_mb: mem_used / 1024,
        mem_total_mb: mem_total / 1024,
        mem_percent,
        load_1,
    }
}
