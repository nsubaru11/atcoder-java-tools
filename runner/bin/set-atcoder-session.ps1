param([string]$Session, [string]$SessionFile = "$HOME\.atcoder\session.txt")

$ErrorActionPreference = "Stop"

if ( [string]::IsNullOrWhiteSpace($Session)) {
	$secure = Read-Host "Enter REVEL_SESSION value" -AsSecureString
	$Session = [System.Net.NetworkCredential]::new("", $secure).Password
}

if ( [string]::IsNullOrWhiteSpace($Session)) {
	Write-Host "Error: Session value is empty." -ForegroundColor Red
	exit 1
}

$Session = $Session -replace "^REVEL_SESSION="

$null = New-Item -ItemType Directory -Path (Split-Path $SessionFile) -Force

Set-Content -Path $SessionFile -Value $Session -Encoding UTF8

Write-Host "Saved session to: $SessionFile" -ForegroundColor Green
Write-Host "You are now ready to use the submit command." -ForegroundColor Magenta