param([string]$Session, [string]$SessionFile = "$HOME\.atcoder\session.txt")

$ErrorActionPreference = "Stop"

if ( [string]::IsNullOrWhiteSpace($Session)) {
	$secure = Read-Host "Enter REVEL_SESSION value" -AsSecureString
	$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
	try {
		$Session = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
	}
	finally {
		[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
	}
}

if ( [string]::IsNullOrWhiteSpace($Session)) {
	throw "Session value is empty."
}

if ($Session -match "^REVEL_SESSION=") {
	$Session = $Session.Substring("REVEL_SESSION=".Length)
}

$dir = Split-Path -Parent $SessionFile
if (-not (Test-Path $dir)) {
	New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

Set-Content -Path $SessionFile -Value $Session -Encoding UTF8
Write-Output "Saved session to: $SessionFile"
Write-Output "submit will auto-read this file if ATCODER_SESSION and ATCODER_COOKIE are not set."
