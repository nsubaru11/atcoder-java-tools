param([string]$JavaVer = "24")

$ErrorActionPreference = "Stop"

function Write-RunnerMessage {
	param([string]$Message = "")
	[Console]::WriteLine($Message)
}

function Write-RunnerWarning {
	param([string]$Message)
	[Console]::Error.WriteLine("WARNING: $Message")
}

function ConvertTo-BashSingleQuotedLiteral {
	param([AllowNull()][string]$Value)

	if ($null -eq $Value) {
		return "''"
	}

	return "'" + ($Value -replace "'", "'\\''") + "'"
}

function Test-IsInterruptExitCode {
	param([int]$ExitCode)
	return $ExitCode -eq 130 -or $ExitCode -eq -1073741510 -or $ExitCode -eq 3221225786
}

function Start-WindowsLegacyRunner {
	param([string]$ScriptDir, [string]$ServerPath, [string]$JavaVer)

	$javaHomeVar = "JAVA_HOME_$JavaVer"
	$javaPath = [Environment]::GetEnvironmentVariable($javaHomeVar)

	Write-RunnerMessage ""
	Write-RunnerMessage "========================================"
	Write-RunnerMessage "  Local Runner Server for Java $JavaVer"
	Write-RunnerMessage "  Mode: Windows / Legacy Fallback"
	Write-RunnerMessage "========================================"
	Write-RunnerMessage "Windows Script Dir: $ScriptDir"
	Write-RunnerMessage "Server Path      : $ServerPath"

	if (-not [string]::IsNullOrWhiteSpace($javaPath)) {
		$env:JAVA_HOME = $javaPath
		Write-RunnerMessage "$javaHomeVar`: $javaPath"
	} else {
		Write-RunnerMessage "$javaHomeVar`: <not set> (using PATH lookup)"
	}

	if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
		throw "Java was not found on Windows PATH and $javaHomeVar is not set."
	}
	if (-not (Get-Command javac -ErrorAction SilentlyContinue)) {
		throw "javac was not found on Windows PATH and $javaHomeVar is not set."
	}
	if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
		throw "node was not found on Windows PATH."
	}

	& java -version
	Write-RunnerMessage "Starting Windows legacy local runner server..."
	$env:LOCAL_RUNNER_MODE = "legacy"
	& node $ServerPath
	$exitCode = if ($null -ne $LASTEXITCODE) {
		$LASTEXITCODE
	} else {
		0
	}
	if (Test-IsInterruptExitCode -ExitCode $exitCode) {
		exit $exitCode
	}
	if ($exitCode -ne 0) {
		throw "Windows legacy runner exited with code $exitCode."
	}
	exit $exitCode
}

function Start-WslRunner {
	param([string]$ScriptDir, [string]$ShPath, [string]$JavaVer)

	if (-not (Test-Path $ShPath)) {
		Write-RunnerWarning "start-local-runner.sh was not found. Falling back to Windows legacy mode."
		return $false
	}

	$wslScriptDir = ""
	try {
		$wslScriptDir = (& wsl.exe wslpath -a $ScriptDir 2> $null | Select-Object -First 1).Trim()
	}
	catch {
		$wslScriptDir = ""
	}

	Write-RunnerMessage "========================================"
	Write-RunnerMessage "  Local Runner Server for Java $JavaVer"
	Write-RunnerMessage "  Mode: WSL / Daemon"
	Write-RunnerMessage "========================================"
	Write-RunnerMessage "Windows Script Dir: $ScriptDir"
	Write-RunnerMessage "WSL Script Dir    : $wslScriptDir"

	if ( [string]::IsNullOrWhiteSpace($wslScriptDir)) {
		Write-RunnerWarning "Failed to resolve the WSL path. Falling back to Windows legacy mode."
		return $false
	}

	Write-RunnerMessage "Starting WSL server..."
	$bashCommands = New-Object System.Collections.Generic.List[string]
	if (-not [string]::IsNullOrWhiteSpace($env:LOCAL_RUNNER_PORT)) {
		$bashCommands.Add("export LOCAL_RUNNER_PORT=" + (ConvertTo-BashSingleQuotedLiteral -Value $env:LOCAL_RUNNER_PORT))
	}
	if (-not [string]::IsNullOrWhiteSpace($env:LOCAL_RUNNER_BASE_DIR)) {
		$bashCommands.Add("export LOCAL_RUNNER_BASE_DIR=" + (ConvertTo-BashSingleQuotedLiteral -Value $env:LOCAL_RUNNER_BASE_DIR))
	}
	$bashCommands.Add("cd " + (ConvertTo-BashSingleQuotedLiteral -Value $wslScriptDir))
	$bashCommands.Add("chmod +x ./start-local-runner.sh")
	$bashCommands.Add("./start-local-runner.sh " + (ConvertTo-BashSingleQuotedLiteral -Value $JavaVer))
	$bashCommand = [string]::Join(" && ", $bashCommands)
	# Merge stderr on bash side to avoid PowerShell NativeCommandError handling in 5.1.
	$bashCommandWithRedirect = "{ $bashCommand; } 2>&1"
	& wsl.exe bash -lc $bashCommandWithRedirect | ForEach-Object {
		Write-RunnerMessage ([string]$_)
	}
	$exitCode = if ($null -ne $LASTEXITCODE) {
		$LASTEXITCODE
	} else {
		0
	}
	if (Test-IsInterruptExitCode -ExitCode $exitCode) {
		exit $exitCode
	}
	if ($exitCode -eq 0) {
		exit 0
	}

	Write-RunnerWarning "The WSL runner exited with code $exitCode. Falling back to Windows legacy mode."
	return $false
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$shPath = Join-Path $scriptDir "start-local-runner.sh"
$serverPath = Join-Path $scriptDir "..\runner\local-runner-server.js"


$wslStarted = Start-WslRunner -ScriptDir $scriptDir -ShPath $shPath -JavaVer $JavaVer

if ($wslStarted) {
	return
}

Start-WindowsLegacyRunner -ScriptDir $scriptDir -ServerPath $serverPath -JavaVer $JavaVer
