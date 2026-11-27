param(
  [Parameter(Mandatory=$true)][string]$JavaHome,
  [Parameter(Mandatory=$true)][string]$SdkJar
)

$ErrorActionPreference = 'Stop'
$JavaHome = (Resolve-Path -LiteralPath $JavaHome).Path
$SdkJar = (Resolve-Path -LiteralPath $SdkJar).Path
$javac = Join-Path $JavaHome 'bin\javac.exe'
if (!(Test-Path -LiteralPath $javac)) { throw 'JavaHome must point to a JDK with javac.exe' }
$javaSources = @(
  (Join-Path $PSScriptRoot '..\server\zatca\java\C14n11.java'),
  (Join-Path $PSScriptRoot '..\server\zatca\java\VerifyXades.java')
) | ForEach-Object { (Resolve-Path -LiteralPath $_).Path }
$output = Join-Path $PSScriptRoot '..\server\zatca\java\build'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$output = (Resolve-Path -LiteralPath $output).Path
& $javac '--release' '11' '-encoding' 'UTF-8' '-classpath' $SdkJar '-d' $output @javaSources
if ($LASTEXITCODE -ne 0) { throw 'Failed to compile the ZATCA Java cryptography helpers' }
Write-Output "Compiled Java helpers to $output"
