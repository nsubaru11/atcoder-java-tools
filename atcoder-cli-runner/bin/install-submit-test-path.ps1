$ErrorActionPreference = "Stop"

$userPath = [Environment]::GetEnvironmentVariable("Path", "User") ?? ""
$pathList = $userPath.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries)

if ($PSScriptRoot -in $pathList) {
	Write-Host "Path already contains: $PSScriptRoot" -ForegroundColor Cyan
} else {
	[Environment]::SetEnvironmentVariable("Path", ($pathList + $PSScriptRoot) -join ";", "User")
	Write-Host "Added to user PATH: $PSScriptRoot" -ForegroundColor Green
}

if ($PSScriptRoot -notin ($env:Path.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries))) {
	$env:Path = "$PSScriptRoot;$env:Path"
	Write-Host "Added to current session PATH: $PSScriptRoot" -ForegroundColor Yellow
}

Write-Host "You can now run: test <task> <file> and submit <task> <file>" -ForegroundColor Magenta