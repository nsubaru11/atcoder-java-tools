param([string]$JavaVer = "24")

$ErrorActionPreference = "Stop"

function Write-RunnerMessage([string]$Message = "") {
	[Console]::WriteLine($Message)
}

function Write-RunnerWarning([string]$Message) {
	Write-Host "WARNING: $Message" -ForegroundColor Yellow
}

function ConvertTo-BashSingleQuotedLiteral([string]$Value) {
	return [string]::IsNullOrEmpty($Value) ? "''": "'$($Value -replace "'", "'\''")'"
}

function Test-IsInterruptExitCode([int]$ExitCode) {
	return $ExitCode -in 130, -1073741510, 3221225786
}

function Start-WslRunner([string]$ScriptDir, [string]$ShPath, [string]$JavaVer) {

	if (!(Test-Path $ShPath)) {
		Write-RunnerWarning "start-local-runner.sh was not found."
		return 1
	}

	if (!(Get-Command "wsl.exe" -ErrorAction SilentlyContinue)) {
		Write-RunnerWarning "wsl.exe is not found. Please ensure WSL is installed."
		return 1
	}

	$wslScriptDir = (wsl.exe wslpath -a $ScriptDir 2> $null)?.Trim()

	Write-RunnerMessage "========================================"
	Write-RunnerMessage "  Local Runner Server for Java $JavaVer"
	Write-RunnerMessage "  Mode: WSL / Daemon"
	Write-RunnerMessage "========================================"
	Write-RunnerMessage "Windows Script Dir: $ScriptDir"
	Write-RunnerMessage "WSL Script Dir    : $wslScriptDir"

	if ([string]::IsNullOrWhiteSpace($wslScriptDir)) {
		Write-RunnerWarning "Failed to resolve the WSL path. Falling back to Windows legacy mode."
		return 1
	}

	Write-RunnerMessage "Starting WSL server..."

	$envExports = @{
		LOCAL_RUNNER_PORT = $env:LOCAL_RUNNER_PORT
		LOCAL_RUNNER_BASE_DIR = $env:LOCAL_RUNNER_BASE_DIR
	}.GetEnumerator() | Where-Object { $_.Value } | ForEach-Object {
		"export $($_.Key)=$(ConvertTo-BashSingleQuotedLiteral $_.Value)"
	}

	$bashCommands = @() + $envExports
	$bashCommands += "cd $(ConvertTo-BashSingleQuotedLiteral $wslScriptDir)"
	$bashCommands += "chmod +x ./start-local-runner.sh"
	$bashCommands += "./start-local-runner.sh $(ConvertTo-BashSingleQuotedLiteral $JavaVer)"

	$bashCommand = $bashCommands -join " && "
	$wslArgs = @("bash", "-lc", $bashCommand)
	$process = Start-Process -FilePath "wsl.exe" -ArgumentList $wslArgs -NoNewWindow -Wait -PassThru
	$exitCode = $process.ExitCode ?? 0

	if (Test-IsInterruptExitCode $exitCode) {
		return $exitCode
	}
	if ($exitCode -eq 0) {
		return 0
	}

	Write-RunnerWarning "The WSL runner exited with code $exitCode."
	return 1
}

$scriptDir = $PSScriptRoot
$shPath = Join-Path $scriptDir "start-local-runner.sh"

$code = Start-WslRunner -ScriptDir $scriptDir -ShPath $shPath -JavaVer $JavaVer
exit $code