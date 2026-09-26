# Ertiper diagnostics: checks each link between the browser, IIS and the board service.
# Run on the board PC in an administrator PowerShell:
#   powershell -ExecutionPolicy Bypass -File diagnose.ps1
# The report is also saved to your Desktop as ertiper-diagnostics.txt.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$report = New-Object System.Collections.Generic.List[string]
function Say($text) { $report.Add($text); Write-Host $text }
function Section($title) { Say ''; Say "=== $title ===" }

function Probe($url) {
    try {
        $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 10
        $body = $r.Content
        "HTTP $($r.StatusCode)  $($body.Substring(0, [Math]::Min(160, $body.Length)))"
    } catch {
        $resp = $_.Exception.Response
        if ($resp) {
            $text = ''
            try { $text = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {}
            # IIS error pages: pull out the headline and detailed error code.
            $h = [regex]::Match($text, '<h3>(.*?)</h3>|<h2>(.*?)</h2>|<title>(.*?)</title>').Value -replace '<[^>]+>', ''
            "HTTP $([int]$resp.StatusCode) $($resp.StatusDescription)  $h"
        } else {
            "NO CONNECTION: $($_.Exception.Message)"
        }
    }
}

$appcmd = "$env:windir\system32\inetsrv\appcmd.exe"
$data = "$env:ProgramData\Ertiper"
# The service's port, from its WinSW definition (8095 unless changed).
$svcXml = "$env:ProgramFiles\Ertiper\ErtiperService.xml"
$svcPort = if (Test-Path $svcXml) { [regex]::Match((Get-Content $svcXml -Raw), 'ERTIPER_PORT" value="(\d+)').Groups[1].Value } else { '8095' }
if (-not $svcPort) { $svcPort = '8095' }

Section 'Service'
$svc = Get-CimInstance Win32_Service -Filter "Name='Ertiper'" -ErrorAction SilentlyContinue
if ($svc) { Say "State: $($svc.State)   Start: $($svc.StartMode)   Account: $($svc.StartName)   Exit code: $($svc.ExitCode)" }
else { Say 'NOT INSTALLED' }
$node = Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*Ertiper*' }
Say ("Node process: " + $(if ($node) { "running (PID $($node.Id -join ', '))" } else { 'not running' }))
$listen = Get-NetTCPConnection -LocalPort $svcPort -State Listen -ErrorAction SilentlyContinue
if ($listen) {
    foreach ($l in $listen) { Say "Port ${svcPort}: listening on $($l.LocalAddress) by $((Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue).Path)" }
} else { Say "Port ${svcPort}: nothing listening" }

Section "Board service directly (http://127.0.0.1:$svcPort)"
Say (Probe "http://127.0.0.1:$svcPort/api/config")

Section 'IIS add-ons'
Say ("URL Rewrite: " + $(if (Test-Path "$env:windir\system32\inetsrv\rewrite.dll") { 'installed' } else { 'MISSING' }))
Say ("ARR:         " + $(if (Test-Path "$env:ProgramFiles\IIS\Application Request Routing\requestRouter.dll") { 'installed' } else { 'MISSING' }))
if (Test-Path $appcmd) {
    $proxy = & $appcmd list config -section:system.webServer/proxy 2>&1 | Out-String
    $enabled = [regex]::Match($proxy, 'enabled="(\w+)"').Groups[1].Value
    Say ("ARR proxy:   " + $(if ($enabled) { "enabled=$enabled" } else { "not configured: $($proxy.Trim())" }))
} else { Say 'appcmd.exe not found - is IIS installed?' }

Section 'IIS site "ertiper"'
if (Test-Path $appcmd) {
    Say ((& $appcmd list site /name:ertiper 2>&1 | Out-String).Trim())
    $folder = [Environment]::ExpandEnvironmentVariables(((& $appcmd list vdir 'ertiper/' /text:physicalPath 2>&1) | Out-String).Trim())
    $pool = ((& $appcmd list app 'ertiper/' /text:applicationPool 2>&1) | Out-String).Trim()
    Say "Folder: $folder"
    Say "App pool: $pool  $((& $appcmd list apppool /name:$pool /text:state 2>&1 | Out-String).Trim())"
    foreach ($f in 'index.html', 'app.js', 'web.config') {
        Say ("  $f " + $(if (Test-Path (Join-Path $folder $f)) { 'present' } else { 'MISSING' }))
    }
    $bindings = ((& $appcmd list site /name:ertiper /text:bindings 2>&1) | Out-String).Trim()
    $port = [regex]::Match($bindings, ':(\d+):').Groups[1].Value
    if (-not $port) { $port = '8081' }
}

Section "Through IIS (http://localhost:$port)"
Say ("Page:     " + (Probe "http://localhost:$port/"))
Say ("API:      " + (Probe "http://localhost:$port/api/config"))

Section 'Settings file'
$cfg = Join-Path $data 'config.json'
if (Test-Path $cfg) {
    try { $null = (Get-Content $cfg -Raw) -replace "^﻿", '' | ConvertFrom-Json; Say "$cfg - valid JSON" }
    catch { Say "$cfg - INVALID JSON: $($_.Exception.Message)" }
} else { Say "$cfg - MISSING" }

Section 'Service logs (last 25 lines each)'
foreach ($log in Get-ChildItem "$data\logs" -Filter 'ErtiperService*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3) {
    Say "--- $($log.Name) ($($log.LastWriteTime))"
    Get-Content $log.FullName -Tail 25 | ForEach-Object { Say $_ }
}

Section 'Recent service errors in the Windows event log'
Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Service Control Manager'; StartTime = (Get-Date).AddDays(-1) } -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match 'Ertiper' } | Select-Object -First 5 |
    ForEach-Object { Say "$($_.TimeCreated)  $($_.Message)" }

$out = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ertiper-diagnostics.txt'
$report | Set-Content $out -Encoding UTF8
Write-Host ''
Write-Host "Saved to $out" -ForegroundColor Green
