# Rail-IQ local server — serves this folder at http://localhost:8080 (no Python or Node needed).
# Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8080]
#
# Sign-in: if a file named .railiq-users exists next to this script (one "user:password"
# per line, # for comments), the browser asks for a username and password. The file is
# excluded from git and never served. Without the file the local server is open.
param([int]$Port = 8080)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$types = @{
  ".html"="text/html; charset=utf-8"; ".htm"="text/html; charset=utf-8"; ".css"="text/css; charset=utf-8";
  ".js"="text/javascript; charset=utf-8"; ".json"="application/json; charset=utf-8"; ".svg"="image/svg+xml";
  ".png"="image/png"; ".jpg"="image/jpeg"; ".jpeg"="image/jpeg"; ".gif"="image/gif"; ".ico"="image/x-icon";
  ".md"="text/plain; charset=utf-8"; ".txt"="text/plain; charset=utf-8"; ".py"="text/plain; charset=utf-8";
  ".xlsx"="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  ".docx"="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  ".pdf"="application/pdf"; ".woff2"="font/woff2"; ".zip"="application/zip"
}

# users for sign-in
$users = @{}
$usersFile = Join-Path $root ".railiq-users"
if (Test-Path $usersFile) {
  foreach ($line in Get-Content $usersFile) {
    $l = $line.Trim()
    if ($l -eq "" -or $l.StartsWith("#")) { continue }
    $i = $l.IndexOf(":")
    if ($i -gt 0) { $users[$l.Substring(0, $i)] = $l.Substring($i + 1) }
  }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
if ($users.Count -gt 0) {
  $listener.AuthenticationSchemes = [System.Net.AuthenticationSchemes]::Basic
  $listener.Realm = "Rail-IQ"
}
$listener.Start()
$mode = $(if ($users.Count -gt 0) { "sign-in required, $($users.Count) users" } else { "open, no .railiq-users file" })
Write-Host "Rail-IQ running at http://localhost:$Port/  ($mode; Ctrl+C to stop)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      if ($users.Count -gt 0) {
        $id = $ctx.User.Identity
        if (-not $id -or -not $users.ContainsKey($id.Name) -or $users[$id.Name] -cne $id.Password) {
          $res.StatusCode = 401
          $res.AddHeader("WWW-Authenticate", 'Basic realm="Rail-IQ", charset="UTF-8"')
          $bytes = [Text.Encoding]::UTF8.GetBytes("Rail-IQ: sign in required.")
          $res.ContentLength64 = $bytes.Length
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
          continue
        }
      }
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq "" -or $rel.EndsWith("/")) { $rel = $rel + "index.html" }
      $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
      $hidden = ($rel -split "[\\/]") | Where-Object { $_.StartsWith(".") }  # never serve dot-files (.git, .railiq-users)
      if ($hidden -or -not $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $path -PathType Leaf)) {
        $res.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
      } else {
        $ext = [IO.Path]::GetExtension($path).ToLower()
        $res.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { "application/octet-stream" })
        $res.Headers.Add("Cache-Control", "no-cache")
        $bytes = [IO.File]::ReadAllBytes($path)
      }
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch { $res.StatusCode = 500 } finally { $res.OutputStream.Close() }
  }
} finally { $listener.Stop() }
