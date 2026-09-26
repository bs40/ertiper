# Builds installer\dist\ErtiperSetup-<version>.exe
# Downloads the bundled third-party parts into installer\vendor (once), checks them, then runs Inno Setup.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$vendor = Join-Path $here 'vendor'
New-Item -ItemType Directory -Force $vendor | Out-Null

function Get-File($url, $path) {
    if (Test-Path $path) { return }
    Write-Host "Downloading $url"
    Invoke-WebRequest -Uri $url -OutFile "$path.part" -UseBasicParsing
    Move-Item "$path.part" $path -Force
}

function Assert-Signed($path, $publisher) {
    $sig = Get-AuthenticodeSignature $path
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch $publisher) {
        throw "$path is not validly signed by $publisher (status: $($sig.Status))"
    }
}

# --- Node.js runtime (latest 24.x LTS), verified against the official SHA-256 list ---
$nodeExe = Join-Path $vendor 'node\node.exe'
if (-not (Test-Path $nodeExe)) {
    $sums = (Invoke-WebRequest 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' -UseBasicParsing).Content
    $line = ($sums -split "`n") | Where-Object { $_ -match 'node-v[\d.]+-win-x64\.zip$' } | Select-Object -First 1
    $hash, $zipName = $line.Trim() -split '\s+'
    $zip = Join-Path $vendor $zipName
    Get-File "https://nodejs.org/dist/latest-v24.x/$zipName" $zip
    if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $hash.ToUpper()) { Remove-Item $zip; throw 'Node.js download failed its SHA-256 check' }
    $tmp = Join-Path $vendor 'node-extract'
    Expand-Archive $zip $tmp -Force
    $dir = Get-ChildItem $tmp -Directory | Select-Object -First 1
    New-Item -ItemType Directory -Force (Join-Path $vendor 'node') | Out-Null
    Copy-Item (Join-Path $dir.FullName 'node.exe') $nodeExe
    Copy-Item (Join-Path $dir.FullName 'LICENSE') (Join-Path $vendor 'node\LICENSE')
    Remove-Item $tmp -Recurse -Force
    Remove-Item $zip
}
Assert-Signed $nodeExe 'OpenJS Foundation'
Write-Host "Node.js: $(& $nodeExe --version)"

# --- WinSW service wrapper (MIT) ---
$winsw = Join-Path $vendor 'WinSW.exe'
Get-File 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe' $winsw

# --- IIS URL Rewrite 2.1 and Application Request Routing 3.0 (Microsoft) ---
$rewrite = Join-Path $vendor 'rewrite_amd64_en-US.msi'
$arr = Join-Path $vendor 'requestRouter_amd64.msi'
Get-File 'https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi' $rewrite
Get-File 'https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi' $arr
Assert-Signed $rewrite 'Microsoft'
Assert-Signed $arr 'Microsoft'

# --- Self-hosted browser assets (Leaflet, fonts) into public\vendor ---
Push-Location $root
try {
    npm ci --ignore-scripts --no-audit --no-fund | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    node scripts/vendor.mjs
    if ($LASTEXITCODE -ne 0) { throw 'vendor step failed' }
} finally { Pop-Location }

# --- Compile ---
$iscc = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 not found. Install it with: winget install JRSoftware.InnoSetup' }

$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version

# The service port lives in two files; make sure they agree before building.
$svcXml = Get-Content (Join-Path $here 'ErtiperService.xml') -Raw
$webConfig = Get-Content (Join-Path $root 'public\web.config') -Raw
$port = [regex]::Match($svcXml, 'name="ERTIPER_PORT" value="(\d+)"').Groups[1].Value
if (-not $port) { throw 'ERTIPER_PORT not found in ErtiperService.xml' }
if ($webConfig -notmatch "http://127\.0\.0\.1:$port/api/") { throw "public\web.config does not forward to port $port (ErtiperService.xml uses $port)" }
Write-Host "Service port: $port"

& $iscc "/DAppVersion=$version" "/DServicePort=$port" (Join-Path $here 'ertiper.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE" }
