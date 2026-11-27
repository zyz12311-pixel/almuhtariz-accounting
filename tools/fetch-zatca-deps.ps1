#!/usr/bin/env pwsh
<#
.SYNOPSIS
Downloads Apache Santuario (xmlsec 1.5.8) and transitive dependencies with pinned SHA-256 hashes.
This makes the ZATCA XML security build self-contained and reproducible.

.NOTES
Apache Santuario xmlsec 1.5.8 is under Apache License 2.0 - redistributable.
ZATCA SDK is NOT redistributable - must be provided by user or downloaded from ZATCA portal.
#>

$ErrorActionPreference = "Stop"

$libDir = "$PSScriptRoot\zatca-lib"
if (-not (Test-Path $libDir)) { New-Item -ItemType Directory -Path $libDir | Out-Null }

# Apache Santuario xmlsec 1.5.8 + transitive dependencies (from SDK 3.4.8 manifest)
# All under Apache License 2.0 / compatible licenses - redistributable
$dependencies = @(
    @{ url="https://repo1.maven.org/maven2/org/apache/santuario/xmlsec/1.5.8/xmlsec-1.5.8.jar"; 
       sha256="f5965da6ba78949bc17724c56de70c4aeb2598663f6abb1ece63854ba21713ba"; 
       file="xmlsec-1.5.8.jar" },
    @{ url="https://repo1.maven.org/maven2/commons-logging/commons-logging/1.2/commons-logging-1.2.jar"; 
       sha256="daddea1ea0be0f56978ab3006b8ac92834afeefbd9b7e4e6316fca57df0fa636"; 
       file="commons-logging-1.2.jar" },
    @{ url="https://repo1.maven.org/maven2/commons-codec/commons-codec/1.15/commons-codec-1.15.jar"; 
       sha256="b3e9f6d63a790109bf0d056611fbed1cf69055826defeb9894a71369d246ed63"; 
       file="commons-codec-1.15.jar" },
    @{ url="https://repo1.maven.org/maven2/org/apache/commons/commons-lang3/3.12.0/commons-lang3-3.12.0.jar"; 
       sha256="d919d904486c037f8d193412da0c92e22a9fa24230b9d67a57855c5c31c7e94e"; 
       file="commons-lang3-3.12.0.jar" },
    @{ url="https://repo1.maven.org/maven2/commons-io/commons-io/2.11.0/commons-io-2.11.0.jar"; 
       sha256="961b2f6d87dbacc5d54abf45ab7a6e2495f89b75598962d8c723cea9bc210908"; 
       file="commons-io-2.11.0.jar" },
    @{ url="https://repo1.maven.org/maven2/jaxen/jaxen/1.2.0/jaxen-1.2.0.jar"; 
       sha256="70feef9dd75ad064def05a3ce8975aeba515ee7d1be146d12199c8828a64174c"; 
       file="jaxen-1.2.0.jar" },
    @{ url="https://repo1.maven.org/maven2/org/apache/logging/log4j/log4j-api/2.17.2/log4j-api-2.17.2.jar"; 
       sha256="09351b5a03828f369cdcff76f4ed39e6a6fc20f24f046935d0b28ef5152f8ce4"; 
       file="log4j-api-2.17.2.jar" },
    @{ url="https://repo1.maven.org/maven2/org/apache/logging/log4j/log4j-core/2.17.2/log4j-core-2.17.2.jar"; 
       sha256="5adb34ff4197cd16a8d24f63035856a933cb59562a6888dde86e9450fcfef646"; 
       file="log4j-core-2.17.2.jar" },
    @{ url="https://repo1.maven.org/maven2/com/fasterxml/jackson/core/jackson-databind/2.15.2/jackson-databind-2.15.2.jar"; 
       sha256="0eb2fdad6e40ab8832a78c9b22f58196dd970594e8d3d5a26ead87847c4f3a96"; 
       file="jackson-databind-2.15.2.jar" },
    @{ url="https://repo1.maven.org/maven2/com/fasterxml/jackson/core/jackson-core/2.15.2/jackson-core-2.15.2.jar"; 
       sha256="303c99e82b1faa91a0bae5d8fbeb56f7e2adf9b526a900dd723bf140d62bd4b4"; 
       file="jackson-core-2.15.2.jar" },
    @{ url="https://repo1.maven.org/maven2/com/fasterxml/jackson/core/jackson-annotations/2.15.2/jackson-annotations-2.15.2.jar"; 
       sha256="04e21f94dcfee4b078fa5a5f53047b785aaba69d19de392f616e7a7fe5d3882f"; 
       file="jackson-annotations-2.15.2.jar" }
)

function Get-Sha256($path) {
    $hash = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($path)
    $bytes = $hash.ComputeHash($stream)
    $stream.Close()
    return ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

Write-Host "Downloading Apache Santuario xmlsec 1.5.8 + dependencies..." -ForegroundColor Cyan

foreach ($dep in $dependencies) {
    $output = Join-Path $libDir $dep.file
    
    if (Test-Path $output) {
        $existingHash = Get-Sha256 $output
        if ($existingHash -eq $dep.sha256) {
            Write-Host "  [OK] $($dep.file) - hash verified" -ForegroundColor Green
            continue
        } else {
            Write-Host "  [WARN] $($dep.file) - hash mismatch, re-downloading" -ForegroundColor Yellow
            Remove-Item $output -Force
        }
    }
    
    Write-Host "  Downloading $($dep.file)..." -NoNewline
    try {
        Invoke-WebRequest -Uri $dep.url -OutFile $output -UseBasicParsing -ErrorAction Stop
        $actualHash = Get-Sha256 $output
        if ($actualHash -eq $dep.sha256) {
            Write-Host " done, hash verified" -ForegroundColor Green
        } else {
            Write-Host " done, HASH MISMATCH!" -ForegroundColor Red
            Write-Host "    Expected: $($dep.sha256)"
            Write-Host "    Actual:   $actualHash"
            Remove-Item $output -Force
            throw "SHA-256 verification failed for $($dep.file)"
        }
    } catch {
        Write-Host " FAILED" -ForegroundColor Red
        Write-Error "Failed to download $($dep.file): $_"
        throw $_
    }
}

Write-Host "`nAll Apache Santuario dependencies downloaded and verified." -ForegroundColor Cyan
Write-Host "Location: $libDir" -ForegroundColor Cyan

# ZATCA SDK note
Write-Host "`nNOTE: ZATCA SDK (zatca-einvoicing-sdk-238-R3.4.8.jar) is NOT redistributable." -ForegroundColor Yellow
Write-Host "Place it manually in: $libDir" -ForegroundColor Yellow
Write-Host "Or download from ZATCA developer portal." -ForegroundColor Yellow