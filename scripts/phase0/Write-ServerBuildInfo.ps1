param(
  [string]$ServerPath = ".\skymp\server"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not [System.IO.Path]::IsPathRooted($ServerPath)) {
  $ServerPath = Join-Path $root $ServerPath
}
$server = (Resolve-Path -LiteralPath $ServerPath).Path
$manifestPath = Join-Path $root "patches\manifest.json"
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$declaredPin = [string]$manifest.upstream.pin

if ($declaredPin -notmatch '^[0-9a-f]{40}$') {
  throw "patches/manifest.json nao possui upstream.pin SHA-1 valido."
}

$existingPath = Join-Path $server "BUILD_INFO.json"
$artifactCommit = $null
if (Test-Path -LiteralPath $existingPath) {
  try {
    $existing = Get-Content -Raw -LiteralPath $existingPath | ConvertFrom-Json
    if ($existing.upstreamCommit) { $artifactCommit = [string]$existing.upstreamCommit }
    elseif ($existing.artifactCommit) { $artifactCommit = [string]$existing.artifactCommit }
  } catch {
    throw "BUILD_INFO.json do artefato existe, mas e invalido: $($_.Exception.Message)"
  }
}

if ($artifactCommit -and $artifactCommit -ne $declaredPin) {
  throw "Commit do artefato ($artifactCommit) diverge do pin declarado ($declaredPin)."
}

$packagePath = Join-Path $server "package.json"
$packageVersion = $null
if (Test-Path -LiteralPath $packagePath) {
  $packageVersion = [string](Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json).version
}

$hashes = [ordered]@{}
foreach ($relativePath in @("dist_back\skymp5-server.js", "scam_native.node")) {
  $fullPath = Join-Path $server $relativePath
  if (-not (Test-Path -LiteralPath $fullPath)) {
    throw "Arquivo critico ausente no artefato: $relativePath"
  }
  $hashes[$relativePath.Replace('\', '/')] = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$info = [ordered]@{
  schemaVersion = 1
  declaredUpstreamPin = $declaredPin
  artifactCommit = $artifactCommit
  commitVerified = [bool]($artifactCommit -and $artifactCommit -eq $declaredPin)
  packageVersion = $packageVersion
  platform = "win32-x64"
  installedAtUtc = [DateTime]::UtcNow.ToString("o")
  sha256 = $hashes
}

$info | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $existingPath -Encoding UTF8
Write-Host "BUILD_INFO=$existingPath"
Write-Host "DeclaredPin=$declaredPin CommitVerified=$($info.commitVerified)"
if (-not $info.commitVerified) {
  Write-Warning "O artefato nao declarou upstreamCommit. Os hashes o identificam, mas o commit de origem ainda nao esta comprovado."
}
