param()

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$pathList = @()
if (-not [string]::IsNullOrWhiteSpace($userPath)) {
	$pathList = $userPath.Split(";") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
}

if ($pathList -contains $repoRoot) {
	Write-Output "Path already contains: $repoRoot"
} else {
	$updated = ($pathList + $repoRoot) -join ";"
	[Environment]::SetEnvironmentVariable("Path", $updated, "User")
	Write-Output "Added to user PATH: $repoRoot"
}

if (-not (($env:Path.Split(";") | Where-Object { $_ -eq $repoRoot }).Count -gt 0)) {
	$env:Path = "$repoRoot;$env:Path"
	Write-Output "Added to current session PATH: $repoRoot"
}

Write-Output "You can now run: test <task> <file> and submit <task> <file>"
