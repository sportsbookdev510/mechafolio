# Local static server for the MECHAFOLIO fork (TcpListener — no HttpListener).
# Pretty URLs (/hangar) + proxy of /api/* and /live.json to the live origin.
param(
  [int]$Port = 4173,
  [string]$Origin = 'https://mechafolio.xyz'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = $PSScriptRoot
$utf8 = [Text.UTF8Encoding]::new($false)

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.glb'  = 'model/gltf-binary'
  '.wasm' = 'application/wasm'
  '.ico'  = 'image/x-icon'
  '.txt'  = 'text/plain; charset=utf-8'
}

$pretty = @{
  '/hangar' = 'hangar.html'
  '/arena'  = 'arena.html'
  '/yard'   = 'yard.html'
  '/ledger' = 'ledger.html'
  '/docs'   = 'docs.html'
}

function Write-HttpResponse($stream, [int]$status, [string]$reason, [string]$contentType, [byte[]]$body) {
  $header = "HTTP/1.1 $status $reason`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
  $hb = $utf8.GetBytes($header)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

function Get-LocalFile([string]$urlPath) {
  if ($urlPath -eq '/') { $urlPath = '/index.html' }
  $rel = $null
  if ($pretty.ContainsKey($urlPath)) { $rel = $pretty[$urlPath] }
  else { $rel = $urlPath.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar) }
  if ([string]::IsNullOrWhiteSpace($rel)) { return $null }
  $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
  $rootFull = [IO.Path]::GetFullPath($root)
  if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  if (Test-Path $full -PathType Leaf) { return $full }
  return $null
}

function Get-Fallback([string]$path) {
  if ($path -eq '/live.json') { return (Join-Path $root 'live.json') }
  if ($path -match '^/api/([^?]+)$') {
    $cand = Join-Path $root ('api\' + $Matches[1] + '.json')
    if (Test-Path $cand) { return $cand }
  }
  return $null
}

function Invoke-Proxy([string]$method, [string]$pathAndQuery, [byte[]]$reqBody, [string]$reqContentType) {
  $url = $Origin.TrimEnd('/') + $pathAndQuery
  $client = [Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromSeconds(30)
  try {
    $msg = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($method), $url)
    if ($reqBody -and $reqBody.Length) {
      $msg.Content = [Net.Http.ByteArrayContent]::new($reqBody)
      if ($reqContentType) { $null = $msg.Content.Headers.TryAddWithoutValidation('Content-Type', $reqContentType) }
    }
    $up = $client.SendAsync($msg).GetAwaiter().GetResult()
    $bytes = $up.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $ctype = [string]$up.Content.Headers.ContentType
    if (-not $ctype) { $ctype = 'application/json; charset=utf-8' }
    return @{ Status = [int]$up.StatusCode; Type = $ctype; Body = $bytes }
  } finally { $client.Dispose() }
}

function Read-Request($stream) {
  $buf = New-Object byte[] 8192
  $ms = [IO.MemoryStream]::new()
  $headerEnd = -1
  while ($headerEnd -lt 0) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $ms.Write($buf, 0, $n)
    $all = $ms.ToArray()
    for ($i = 0; $i -le $all.Length - 4; $i++) {
      if ($all[$i] -eq 13 -and $all[$i+1] -eq 10 -and $all[$i+2] -eq 13 -and $all[$i+3] -eq 10) {
        $headerEnd = $i; break
      }
    }
  }
  if ($headerEnd -lt 0) { return $null }
  $raw = $ms.ToArray()
  $headText = $utf8.GetString($raw, 0, $headerEnd)
  $lines = $headText -split "`r`n"
  $reqLine = $lines[0] -split ' '
  $headers = @{}
  foreach ($line in $lines[1..($lines.Length-1)]) {
    $i = $line.IndexOf(':')
    if ($i -gt 0) { $headers[$line.Substring(0, $i).Trim().ToLowerInvariant()] = $line.Substring($i + 1).Trim() }
  }
  $bodyStart = $headerEnd + 4
  $have = $raw.Length - $bodyStart
  $need = 0
  if ($headers.ContainsKey('content-length')) { $need = [int]$headers['content-length'] }
  $bodyMs = [IO.MemoryStream]::new()
  if ($have -gt 0) { $bodyMs.Write($raw, $bodyStart, [Math]::Min($have, $need)) }
  while ($bodyMs.Length -lt $need) {
    $n = $stream.Read($buf, 0, [Math]::Min($buf.Length, $need - [int]$bodyMs.Length))
    if ($n -le 0) { break }
    $bodyMs.Write($buf, 0, $n)
  }
  $uri = [Uri]::new('http://local' + $reqLine[1])
  return @{
    Method = $reqLine[0]
    Path = [Uri]::UnescapeDataString($uri.AbsolutePath)
    PathAndQuery = $uri.PathAndQuery
    Headers = $headers
    Body = $bodyMs.ToArray()
  }
}

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host "MECHAFOLIO fork  http://127.0.0.1:$Port/"
Write-Host "API proxy        $Origin/api/*"
Write-Host "Ctrl+C to stop."

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $stream.ReadTimeout = 15000
      $stream.WriteTimeout = 15000
      $req = Read-Request $stream
      if (-not $req) { continue }
      $path = $req.Path
      if ($path.StartsWith('/api/') -or $path -eq '/live.json') {
        try {
          $up = Invoke-Proxy $req.Method $req.PathAndQuery $req.Body $req.Headers['content-type']
          Write-HttpResponse $stream $up.Status 'OK' $up.Type $up.Body
        } catch {
          $fb = Get-Fallback $path
          if ($fb -and (Test-Path $fb)) {
            $ext = [IO.Path]::GetExtension($fb).ToLowerInvariant()
            $type = $mime[$ext]; if (-not $type) { $type = 'application/json' }
            Write-HttpResponse $stream 200 'OK' $type ([IO.File]::ReadAllBytes($fb))
          } else {
            Write-HttpResponse $stream 502 'Bad Gateway' 'application/json' ($utf8.GetBytes('{"error":"proxy failed"}'))
          }
        }
      } else {
        $file = Get-LocalFile $path
        if ($file) {
          $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
          $type = $mime[$ext]; if (-not $type) { $type = 'application/octet-stream' }
          Write-HttpResponse $stream 200 'OK' $type ([IO.File]::ReadAllBytes($file))
        } else {
          Write-HttpResponse $stream 404 'Not Found' 'text/plain; charset=utf-8' ($utf8.GetBytes('not found'))
        }
      }
    } catch {
      # drop the connection
    } finally {
      try { $client.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
}
