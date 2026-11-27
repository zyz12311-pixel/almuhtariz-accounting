#!/usr/bin/env pwsh
<#
.SYNOPSIS
Builds ZATCA Java cryptography helpers (C14n11, VerifyXades) using local, pinned dependencies.

DESCRIPTION
Uses Apache Santuario xmlsec 1.5.8 + transitive deps from tools/zatca-lib/ (Apache 2.0, redistributable).
ZATCA SDK jar must be placed in tools/zatca-lib/ or provided via -SdkJar parameter.

.NOTES
- No external machine-specific paths required
- All redistributable deps downloaded via fetch-zatca-deps.ps1 with pinned SHA-256
- ZATCA SDK is NOT redistributable - user must provide it
#>

param(
  [Parameter(Mandatory=$true)][string]$JavaHome,
  [string]$SdkJar
)

$ErrorActionPreference = 'Stop'

$JavaHome = (Resolve-Path -LiteralPath $JavaHome).Path
$javac = Join-Path $JavaHome 'bin\javac.exe'
if (!(Test-Path -LiteralPath $javac)) { throw 'JavaHome must point to a JDK with javac.exe (JDK 11+)' }

# Local redistributable dependencies (Apache Santuario + transitive)
$libDir = Join-Path $PSScriptRoot 'zatca-lib'
if (!(Test-Path -LiteralPath $libDir)) { throw "Missing $libDir - run tools/fetch-zatca-deps.ps1 first" }

$localJars = Get-ChildItem -LiteralPath $libDir -Filter '*.jar' -File | ForEach-Object { $_.FullName }
if ($localJars.Count -eq 0) { throw "No JARs found in $libDir - run tools/fetch-zatca-deps.ps1 first" }

# ZATCA SDK (non-redistributable) - optional, only needed for official SDK comparison tests
$classpath = $localJars -join ';'
if (-not $SdkJar) {
    $sdkLocal = Get-ChildItem -LiteralPath $libDir -Filter 'zatca-einvoicing-sdk-*.jar' -File | Select-Object -First 1
    if ($sdkLocal) {
        $SdkJar = $sdkLocal.FullName
        Write-Host "Using local ZATCA SDK: $SdkJar (for official SDK tests)" -ForegroundColor Cyan
        $classpath = ($localJars + @($SdkJar) | Sort-Object -Unique) -join ';'
    } else {
        Write-Host "ZATCA SDK not found - building without SDK (official SDK tests will be skipped)" -ForegroundColor Yellow
    }
} else {
    $SdkJar = (Resolve-Path -LiteralPath $SdkJar).Path
    $classpath = ($localJars + @($SdkJar) | Sort-Object -Unique) -join ';'
    Write-Host "Using provided ZATCA SDK: $SdkJar" -ForegroundColor Cyan
}

$javaSources = @(
  (Join-Path $PSScriptRoot '..\server\zatca\java\C14n11.java'),
  (Join-Path $PSScriptRoot '..\server\zatca\java\VerifyXades.java')
) | ForEach-Object { (Resolve-Path -LiteralPath $_).Path }

$output = Join-Path $PSScriptRoot '..\server\zatca\java\build'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$output = (Resolve-Path -LiteralPath $output).Path

Write-Host "Compiling with classpath:" -ForegroundColor Cyan
$classpath.Split(';') | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }

& $javac '--release' '11' '-encoding' 'UTF-8' '-classpath' $classpath '-d' $output @javaSources
if ($LASTEXITCODE -ne 0) { throw 'Failed to compile the ZATCA Java cryptography helpers' }

Write-Host "`nCompiled Java helpers to $output" -ForegroundColor Green
Write-Host "Classpath for runtime: $classpath" -ForegroundColor Cyan