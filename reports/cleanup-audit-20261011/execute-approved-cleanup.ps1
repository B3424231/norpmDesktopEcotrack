param(
    [Parameter(Mandatory = $true)][ValidateSet('desktop', 'mobile')][string]$Project,
    [Parameter(Mandatory = $true)][ValidateSet('Preflight', 'Delete', 'Verify')][string]$Mode
)

$ErrorActionPreference = 'Stop'
$auditDirectory = $PSScriptRoot
$proposalPath = Join-Path $auditDirectory 'cleanup-proposal.json'
$proposal = Get-Content -Raw -LiteralPath $proposalPath | ConvertFrom-Json
$expectedRoots = @{
    desktop = 'C:\Users\reygay\Desktop\EcoTrackDesktopDashboardNew-main-control'
    mobile = 'C:\Users\reygay\Desktop\EcoTrackAppMobileNew-master-control'
}
$root = [IO.Path]::GetFullPath($expectedRoots[$Project]).TrimEnd('\')
if ($proposal.roots.$Project -ne $root) { throw 'Reviewed project root does not match the intended root.' }
if ($auditDirectory -ne (Join-Path $expectedRoots.desktop 'reports\cleanup-audit-20261011')) { throw 'Unexpected audit directory.' }
$rootPrefix = $root + '\'
$scopes = @{
    A01 = @('firmware/esp32s3_ecotrack_node/build/', 'scratch/EcoTrackMultiBrand/build/', 'scratch/build-live-ir/', 'scratch/build-receiver-monitor/', 'scratch/build-receiver-transmitter/', 'scratch/cloud-receiver-build/', 'scratch/cloud-receiver-pinless-build/', 'scratch/cloud-receiver-pinless-heltec-build/')
    A02 = @('scratch/analytics-climate-modes-electron/', 'scratch/capability-verification-electron/', 'scratch/clear-logs-ui-electron/', 'scratch/connection-recovery-electron/', 'scratch/controller-details-electron/', 'scratch/controller-workflow-electron/', 'scratch/device-setup-ui-electron/', 'scratch/ir-capabilities-electron/', 'scratch/ir-realtime-electron/', 'scratch/live-power-electron/', 'scratch/multi-brand-controls-electron/', 'scratch/node-schedule-times-electron/', 'scratch/notification-removal-electron/', 'scratch/registration-modal-electron/')
    A03 = @('backend/__pycache__/app.cpython-314.pyc', 'scripts/__pycache__/transfer_supabase_to_sqlite.cpython-314.pyc')
    A04 = @('artifacts/EcoTrack-fixed-20261005.apk', 'artifacts/EcoTrack-fetch-improved-20261005.apk', 'artifacts/EcoTrack-device-ui-fixed-20261005.apk', 'artifacts/EcoTrack-device-cards-fixed-20261005.apk', 'artifacts/EcoTrack-mobile-desktop-cloud-20261011.apk')
    A05 = @('artifacts/cloud-integration-android/', 'artifacts/cloud-integration-upload/', 'artifacts/cloud-integration-upload-final/', 'artifacts/cloud-integration-web/', 'artifacts/mobile-home-android/', 'artifacts/mobile-home-upload/', 'artifacts/mobile-home-upload-final/', 'artifacts/mobile-home-visual/', 'artifacts/mobile-ui-cleanup-android/', 'artifacts/mobile-ui-cleanup-upload/', 'artifacts/mobile-ui-cleanup-web/')
    A06 = @('scratch/firmware-build/', 'scratch/firmware-output/', 'scratch/operating-data/firmware/esp32s3_ecotrack_node/build/', 'scratch/android-build-check/', 'scratch/backend-audit/web/', 'scratch/backend-audit/secure-web/')
    A07 = @('.expo/')
}

function Assert-ContainedPath([string]$AbsolutePath) {
    $full = [IO.Path]::GetFullPath($AbsolutePath)
    if (-not $full.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Path outside intended project: $full" }
    $cursor = $full
    while ($cursor.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or $cursor -eq $root) {
        if (Test-Path -LiteralPath $cursor) {
            $attributes = [IO.File]::GetAttributes($cursor)
            if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Link/junction is not approved: $cursor" }
        }
        if ($cursor -eq $root) { break }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    return $full
}

$protectedQueries = @(Get-Content -Raw -LiteralPath (Join-Path $auditDirectory 'protected-query-manifest.json') | ConvertFrom-Json | Where-Object project -eq $Project)
$protectedSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($query in $protectedQueries) { [void]$protectedSet.Add([IO.Path]::GetFullPath((Join-Path $root $query.path))) }
$approvedSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$approved = [Collections.Generic.List[object]]::new()
foreach ($group in @($proposal.groups | Where-Object { $_.category -eq 'A' -and $_.project -eq $Project })) {
    if (-not $scopes.ContainsKey($group.id)) { throw "Unapproved group: $($group.id)" }
    foreach ($file in $group.files) {
        $relative = $file.relativePath.Replace('\', '/')
        if ($relative.StartsWith('/') -or $relative -match '(^|/)\.\.(/|$)') { throw 'Invalid relative path.' }
        $full = Assert-ContainedPath $file.path
        if ($full -ne [IO.Path]::GetFullPath((Join-Path $root $relative))) { throw 'Absolute and relative candidate paths disagree.' }
        $scopeMatches = @($scopes[$group.id] | Where-Object { if ($_.EndsWith('/')) { $relative.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) } else { $relative -eq $_ } })
        if ($scopeMatches.Count -eq 0) { throw "Candidate is outside the reviewed group scope: $relative" }
        if ($protectedSet.Contains($full)) { throw "Query-bearing file is protected: $relative" }
        if ($relative -match '(?i)(\.sql(?:\.[^/]+)?$|\.ino(?:\.txt)?$|\.(?:bin|hex|uf2|db|sqlite|sqlite3)(?:-wal|-shm)?$|(^|/)\.env$|\.(?:pem|p12|keystore|jks|key)$)') { throw "Protected file type: $relative" }
        if ($relative -match '^(?i)(\.git/|\.agents/|node_modules/|venv/|scratch/cloud-db-test-runtime/)') { throw 'Primary development data is protected.' }
        if (-not $approvedSet.Add($full)) { throw 'Duplicate candidate path.' }
        $approved.Add([pscustomobject]@{ group = $group.id; path = $full; relativePath = $relative; bytes = [long]$file.bytes; sha256 = $file.sha256 })
    }
}
if ($approved.Count -ne $proposal.groupASummary.$Project.files) { throw 'Reviewed candidate count does not match.' }

$baselinePath = Join-Path $auditDirectory "$Project-preflight.json"
$deletionPath = Join-Path $auditDirectory "$Project-deletion-results.json"
$verificationPath = Join-Path $auditDirectory "$Project-post-cleanup.json"
function Save-Json($Value, [string]$Path) { $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding UTF8 }
function Get-Hash([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

if ($Mode -eq 'Preflight') {
    $candidateStates = [Collections.Generic.List[object]]::new()
    foreach ($file in $approved) {
        $state = 'unchanged'
        try {
            if (-not (Test-Path -LiteralPath $file.path -PathType Leaf)) { $state = 'missing' }
            elseif ((Get-Item -LiteralPath $file.path -Force).Length -ne $file.bytes -or (Get-Hash $file.path) -ne $file.sha256) { $state = 'changed' }
        } catch { $state = 'unreadable' }
        $candidateStates.Add([pscustomobject]@{ group = $file.group; path = $file.path; bytes = $file.bytes; sha256 = $file.sha256; state = $state })
    }
    $preserved = [Collections.Generic.List[object]]::new()
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($root)
    while ($pending.Count -gt 0) {
        $directory = $pending.Pop()
        foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
            if ($item.PSIsContainer) {
                if ($directory -eq $root -and $item.Name -in @('.git', 'node_modules', 'venv')) { continue }
                if ($item.FullName -eq $auditDirectory) { continue }
                if ($item.FullName -eq (Join-Path $root 'scratch\cloud-db-test-runtime\node_modules')) { continue }
                $pending.Push($item.FullName)
            } elseif (-not $approvedSet.Contains($item.FullName)) {
                $preserved.Add([pscustomobject]@{ path = $item.FullName; bytes = $item.Length; sha256 = Get-Hash $item.FullName })
            }
        }
    }
    $queryStates = @($protectedQueries | ForEach-Object {
        $path = Assert-ContainedPath (Join-Path $root $_.path)
        [pscustomobject]@{ path = $path; auditSha256 = $_.sha256; currentSha256 = Get-Hash $path; unchangedSinceAudit = (Get-Hash $path) -eq $_.sha256 }
    })
    $required = @($proposal.importantRetainedPaths.$Project)
    if ($Project -eq 'mobile') { $required += @($proposal.preserveLatestAPK, $proposal.preserveFallbackAPK) }
    $requiredStates = @($required | ForEach-Object {
        $path = if ([IO.Path]::IsPathRooted($_)) { $_ } else { Join-Path $root $_ }
        $path = Assert-ContainedPath $path
        if (-not (Test-Path -LiteralPath $path)) { throw "Required retained path missing: $path" }
        [pscustomobject]@{ path = $path; exists = $true }
    })
    $state = [pscustomobject]@{ project = $Project; root = $root; time = (Get-Date).ToString('o'); proposalSha256 = Get-Hash $proposalPath; candidates = @($candidateStates.ToArray()); preservedFiles = @($preserved.ToArray()); protectedQueries = $queryStates; requiredPaths = $requiredStates }
    Save-Json $state $baselinePath
    [pscustomobject]@{ project = $Project; mode = $Mode; candidates = $approved.Count; unchanged = @($candidateStates | Where-Object state -eq 'unchanged').Count; skipped = @($candidateStates | Where-Object state -ne 'unchanged').Count; preservedFiles = $preserved.Count; protectedQueries = $queryStates.Count; queryAuditMismatches = @($queryStates | Where-Object unchangedSinceAudit -eq $false).Count } | ConvertTo-Json
    exit 0
}

$baseline = Get-Content -Raw -LiteralPath $baselinePath | ConvertFrom-Json
if ((Get-Hash $proposalPath) -ne $baseline.proposalSha256) { throw 'Reviewed proposal changed after preflight.' }
if ($Mode -eq 'Delete') {
    $outcomes = [Collections.Generic.List[object]]::new()
    if (Test-Path -LiteralPath $deletionPath) { throw 'Deletion results already exist; do not repeat blindly.' }
    foreach ($file in $baseline.candidates) {
        $status = 'skipped-' + $file.state
        $detail = $null
        if ($file.state -eq 'unchanged') {
            try {
                $full = Assert-ContainedPath $file.path
                if (-not $approvedSet.Contains($full)) { throw 'File not in approved list.' }
                if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { $status = 'already-missing' }
                elseif ((Get-Item -LiteralPath $full -Force).Length -ne $file.bytes -or (Get-Hash $full) -ne $file.sha256) { $status = 'skipped-changed' }
                else {
                    Remove-Item -LiteralPath $full -Force -ErrorAction Stop
                    if (Test-Path -LiteralPath $full) { throw 'File remains after deletion.' }
                    $status = 'deleted'
                }
            } catch { $status = 'failed'; $detail = $_.Exception.Message }
        }
        $outcomes.Add([pscustomobject]@{ group = $file.group; path = $file.path; bytes = $file.bytes; status = $status; detail = $detail })
        if ($outcomes.Count % 500 -eq 0) { Write-Output ("{0}: processed {1}/{2}" -f $Project, $outcomes.Count, $baseline.candidates.Count) }
    }
    $deleted = @($outcomes | Where-Object status -eq 'deleted')
    $result = [pscustomobject]@{ project = $Project; root = $root; time = (Get-Date).ToString('o'); authorization = 'User approved recommended Group A with: delete them'; deletedCount = $deleted.Count; deletedBytes = [long](($deleted | Measure-Object bytes -Sum).Sum); retainedCount = $outcomes.Count - $deleted.Count; outcomes = @($outcomes.ToArray()) }
    Save-Json $result $deletionPath
    $result | Select-Object project,deletedCount,deletedBytes,retainedCount | ConvertTo-Json
    exit 0
}

$preservationFailures = [Collections.Generic.List[object]]::new()
foreach ($file in $baseline.preservedFiles) {
    $status = 'unchanged'
    try {
        $full = Assert-ContainedPath $file.path
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { $status = 'missing' }
        elseif ((Get-Item -LiteralPath $full -Force).Length -ne $file.bytes -or (Get-Hash $full) -ne $file.sha256) { $status = 'changed' }
    } catch { $status = 'unreadable' }
    if ($status -ne 'unchanged') { $preservationFailures.Add([pscustomobject]@{ path = $file.path; status = $status }) }
}
$queryFailures = @($baseline.protectedQueries | Where-Object { -not (Test-Path -LiteralPath $_.path -PathType Leaf) -or (Get-Hash $_.path) -ne $_.currentSha256 })
$requiredMissing = @($baseline.requiredPaths | Where-Object { -not (Test-Path -LiteralPath $_.path) })
$deletion = Get-Content -Raw -LiteralPath $deletionPath | ConvertFrom-Json
$deletedStillPresent = @($deletion.outcomes | Where-Object { $_.status -eq 'deleted' -and (Test-Path -LiteralPath $_.path) })
$result = [pscustomobject]@{
    project = $Project; time = (Get-Date).ToString('o'); preservedFileCount = $baseline.preservedFiles.Count; preservationFailures = @($preservationFailures.ToArray()); protectedQueryCount = $baseline.protectedQueries.Count; queryFailures = $queryFailures; requiredMissing = $requiredMissing; deletedStillPresent = $deletedStillPresent
    status = if ($preservationFailures.Count -eq 0 -and $queryFailures.Count -eq 0 -and $requiredMissing.Count -eq 0 -and $deletedStillPresent.Count -eq 0) { 'PASS' } else { 'FAIL' }
}
Save-Json $result $verificationPath
$result | Select-Object project,status,preservedFileCount,protectedQueryCount,@{Name='preservationFailures';Expression={$_.preservationFailures.Count}},@{Name='queryFailures';Expression={$_.queryFailures.Count}},@{Name='requiredMissing';Expression={$_.requiredMissing.Count}},@{Name='deletedStillPresent';Expression={$_.deletedStillPresent.Count}} | ConvertTo-Json
if ($result.status -ne 'PASS') { exit 1 }
