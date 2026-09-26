# Deploys the multi-user flight board to bunny.net Magic Containers.
#
#   .\deploy.ps1              wait for GitHub to build the current commit, then roll it out
#   .\deploy.ps1 -UpdateEnv   also re-send the environment variables from .env (after changing a key)
#
# Keys are read from .env on this PC and sent only to Bunny's API; they never go to GitHub.
# The Bunny ids of the app (created once, on 2026-09-26) are in deploy.state.json.
param(
    [switch]$UpdateEnv,
    [string]$Tag
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$git = @('-c', "safe.directory=%(prefix)///box/Share/Projects/Ertiper")

# --- Settings -----------------------------------------------------------------------------------
$envs = @{}
Get-Content (Join-Path $root '.env') | Where-Object { $_ -match '=' } | ForEach-Object {
    $k, $v = $_ -split '=', 2
    $envs[$k.Trim()] = $v.Trim().Trim('"')
}
$state = Get-Content (Join-Path $root 'deploy.state.json') -Raw | ConvertFrom-Json
$headers = @{ AccessKey = $envs.bunny; 'Content-Type' = 'application/json'; Accept = 'application/json' }
$api = "https://api.bunny.net/mc/apps/$($state.AppId)"

function Get-AppEnvironment {
    $vars = [ordered]@{
        DATABASE_URL = $envs.bunnydb_url; DATABASE_AUTH_TOKEN = $envs.bunnydb_token
        SESSION_SECRET = $envs.session_secret; DATA_KEY = $envs.data_key
        RESEND_API_KEY = $envs.resend; EMAIL_FROM = $envs.email_from
        ADMIN_EMAIL = 'ertiper@bs40.com'; PUBLIC_URL = $state.PublicUrl
        AVIATIONSTACK_KEY = $envs.aviationstack; AVIATIONSTACK_MONTHLY_CAP = '95'; AVIATIONSTACK_REFRESH_HOURS = '12'
        AERODATABOX_KEY = $envs.aerodatabox; AERODATABOX_MONTHLY_UNITS = '4500'
        PLANESPOTTERS_CONTACT = 'planespotters@bs40.com'; PORT = '8080'
    }
    @($vars.GetEnumerator() | Where-Object { $_.Value } | ForEach-Object { @{ name = $_.Key; value = $_.Value } })
}

# --- Which image? ---------------------------------------------------------------------------------
if (-not $Tag) {
    if (git @git status --porcelain) { Write-Warning 'You have uncommitted changes; they are NOT in the deployed image.' }
    $Tag = (git @git rev-parse HEAD).Trim()
    $remote = (git @git ls-remote origin refs/heads/main).Split("`t")[0]
    if ($remote -ne $Tag) { throw "Commit $($Tag.Substring(0,7)) isn't on GitHub yet. Run: git push" }
}
Write-Host "Deploying image ertiper:$($Tag.Substring(0,7))"

# --- Wait for GitHub to build it ------------------------------------------------------------------
$run = gh run list --repo bs40/ertiper --workflow build-image.yml --commit $Tag --limit 1 --json databaseId,status,conclusion | ConvertFrom-Json
if (-not $run) { throw "No GitHub build found for $($Tag.Substring(0,7))." }
if ($run[0].status -ne 'completed') {
    Write-Host 'Waiting for the GitHub build...'
    gh run watch $run[0].databaseId --repo bs40/ertiper --exit-status | Out-Null
    $run = gh run list --repo bs40/ertiper --workflow build-image.yml --commit $Tag --limit 1 --json databaseId,status,conclusion | ConvertFrom-Json
}
if ($run[0].conclusion -ne 'success') { throw "The GitHub build for $($Tag.Substring(0,7)) did not succeed ($($run[0].conclusion))." }

# --- Roll out ---------------------------------------------------------------------------------------
$patch = @{ id = $state.ContainerId; imageTag = $Tag }
if ($UpdateEnv) { $patch.environmentVariables = Get-AppEnvironment }
Invoke-RestMethod "$api/containers/$($state.ContainerId)" -Method Patch -Headers $headers -Body ($patch | ConvertTo-Json -Depth 5) | Out-Null
Write-Host 'Update sent to Magic Containers; waiting for the new version...'

$deadline = (Get-Date).AddMinutes(5)
do {
    Start-Sleep -Seconds 10
    try { $health = Invoke-RestMethod "$($state.PublicUrl)/api/health" -TimeoutSec 10 } catch { $health = $null }
} until (($health -and $health.commit -eq $Tag) -or (Get-Date) -gt $deadline)

if ($health -and $health.commit -eq $Tag) { Write-Host "Live: $($state.PublicUrl)  (version $($health.version), commit $($Tag.Substring(0,7)))" -ForegroundColor Green }
else { Write-Warning "The site hasn't reported the new commit yet. Check Magic Containers → ertiper → Logs." }
