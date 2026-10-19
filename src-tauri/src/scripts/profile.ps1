# husk-shell-integration (PowerShell)
# Emits OSC 7 (cwd) + OSC 133 A/B/D so the host tracks cwd and prompt boundaries.

if ($global:__HUSK_HOOKS_LOADED) { return }
$global:__HUSK_HOOKS_LOADED = $true

try {
    [Console]::InputEncoding  = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $global:OutputEncoding    = [System.Text.UTF8Encoding]::new($false)
} catch {}

if (Test-Path Function:prompt) {
    Copy-Item Function:prompt Function:__husk_user_prompt -Force -ErrorAction SilentlyContinue
}

function global:__husk_urlencode {
    param([string]$s)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($s)
    $sb = [System.Text.StringBuilder]::new($bytes.Length)
    foreach ($b in $bytes) {
        if (($b -ge 0x30 -and $b -le 0x39) -or
            ($b -ge 0x41 -and $b -le 0x5A) -or
            ($b -ge 0x61 -and $b -le 0x7A) -or
            $b -eq 0x2F -or $b -eq 0x2E -or $b -eq 0x5F -or
            $b -eq 0x7E -or $b -eq 0x2D) {
            [void]$sb.Append([char]$b)
        } else {
            [void]$sb.AppendFormat('%{0:X2}', $b)
        }
    }
    $sb.ToString()
}

function global:__husk_report_context {
    $esc = [char]27
    if ($env:SSH_CONNECTION -or $env:SSH_CLIENT -or $env:SSH_TTY -or (Get-Location).Provider.Name -ne 'FileSystem') {
        return "$esc]781;husk;context;1;unavailable$esc\"
    }
    # Read the process environment, never PowerShell's non-exported $HOME.
    $kube = [string]$env:KUBECONFIG
    $defaultKube = ''
    $docker = [string]$env:DOCKER_CONFIG
    $context = [string]$env:DOCKER_CONTEXT
    $dockerHostSet = if ($env:DOCKER_HOST) { '1' } else { '0' }
    $exportedHome = [string]$env:HOME
    if ($exportedHome -match '^(?:/|[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)') {
        if (-not $kube) { $defaultKube = $exportedHome.TrimEnd('/','\') + '/.kube/config' }
        if (-not $docker) { $docker = $exportedHome.TrimEnd('/','\') + '/.docker' }
    }
    $values = @($kube, $defaultKube, $docker, $context)
    $total = 5
    for ($index = 0; $index -lt $values.Length; $index++) {
        $length = [System.Text.Encoding]::UTF8.GetByteCount($values[$index])
        $maximum = if ($index -eq 3) { 1024 } else { 8192 }
        if ($length -gt $maximum) { return "$esc]781;husk;context;1;unavailable$esc\" }
        $total += $length
    }
    if ($total -gt 24576) { return "$esc]781;husk;context;1;unavailable$esc\" }
    $encoded = @($values | ForEach-Object { __husk_urlencode $_ })
    return "$esc]781;husk;context;1;$($encoded -join ';');$dockerHostSet$esc\"
}

function global:prompt {
    $lec = $LASTEXITCODE
    if ($null -eq $lec) { $lec = if ($?) { 0 } else { 1 } }
    $esc = [char]27

    $oscD = "$esc]133;D;$lec$esc\"
    $oscA = "$esc]133;A$esc\"
    $oscB = "$esc]133;B$esc\"

    $original = if (Test-Path Function:__husk_user_prompt) {
        try { & __husk_user_prompt } catch { "PS $((Get-Location).Path)> " }
    } else {
        "PS $((Get-Location).Path)> "
    }

    # Capture final cwd after the user prompt has run (including prompt-time cd).
    $loc = Get-Location
    $osc7 = ''
    if ($loc.Provider.Name -eq 'FileSystem') {
        $cwd = $loc.ProviderPath -replace '\\','/'
        if ($cwd -match '^[A-Za-z]:') { $cwd = "/$cwd" }
        $cwdEnc = __husk_urlencode $cwd
        $hostName = [System.Environment]::MachineName
        $osc7 = "$esc]7;file://$hostName$cwdEnc$esc\"
    }

    # User prompt hooks may update exported selectors before the next command.
    $contextMetadata = __husk_report_context
    $global:LASTEXITCODE = $lec
    "$oscD$oscA$osc7${original}${contextMetadata}${oscB}"
}
