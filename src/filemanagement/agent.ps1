# LAN Share receiver. Installed per user by LAN-Share-Setup.cmd and started at every login.
# Polls the LAN Share server every 5s (every 1s while a prompt is open); when another PC starts
# sending you a file it shows a prompt ("<name> is sending you a file") with a live progress bar and Accept / Decline. Accepted files go to
# Downloads\LAN Share. Needs no admin rights. Log: %LOCALAPPDATA%\LanShare\agent.log
# Updates itself: the server holds the current version number (see /api/agent/version).
$AgentVersion = 5

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12   # needed for https://ssicfile.lan on older .NET defaults
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$dir = Join-Path $env:LOCALAPPDATA 'LanShare'
$logFile = Join-Path $dir 'agent.log'
function Log($m) {
  try {
    if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 200KB) { Remove-Item $logFile -Force }
    Add-Content -Path $logFile -Value ('{0:s} {1}' -f (Get-Date), $m)
  } catch {}
}

# One receiver per user session
$mutex = New-Object System.Threading.Mutex($false, 'Local\LanShareReceiver')
if (-not $mutex.WaitOne(0)) { exit }

$cfg = Get-Content (Join-Path $dir 'config.json') -Raw | ConvertFrom-Json
$script:Server = $cfg.server.TrimEnd('/') + '/'
$recvDir = if ($cfg.recvDir) { $cfg.recvDir } else { Join-Path (Join-Path $env:USERPROFILE 'Downloads') 'LAN Share' }
New-Item -ItemType Directory -Force -Path $recvDir | Out-Null
$selfTest = [bool]$cfg.selfTest   # test hook: auto-accepts invisibly

$idFile = Join-Path $dir 'agent-id.txt'
if (-not (Test-Path $idFile)) { [IO.File]::WriteAllText($idFile, ([guid]::NewGuid().ToString('N').Substring(0, 16))) }
$agentId = (Get-Content $idFile -Raw).Trim()

$script:me = $null
$script:shown = @{}    # transfer id -> state of the prompt currently open
$script:snooze = @{}   # transfer id -> don't ask again until
$script:ticks = 0

function Api($method, $path, $body) {
  $p = @{ Uri = ($script:Server + 'api/' + $path); Method = $method; TimeoutSec = 5 }
  if ($body) { $p.Body = ($body | ConvertTo-Json -Compress); $p.ContentType = 'application/json' }
  Invoke-RestMethod @p
}

function Format-Size($n) {
  $u = 'B', 'KB', 'MB', 'GB', 'TB'; $i = 0; $n = [double]$n
  while ($n -ge 1024 -and $i -lt 4) { $n /= 1024; $i++ }
  if ($i -eq 0) { '{0} {1}' -f [int]$n, $u[$i] } else { '{0:N1} {1}' -f $n, $u[$i] }
}

# ---- SSIC branding: logo from the server, turned into a tray/window icon and a picture for the popup ----
$script:logoImg = $null
$script:logoIcon = $null
function Make-Ico($png, $ico) {
  $src = [System.Drawing.Image]::FromFile($png)
  $bmp = New-Object System.Drawing.Bitmap(64, 64)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)
  $w = [int](64 * $src.Width / $src.Height)
  $g.DrawImage($src, [int]((64 - $w) / 2), 0, $w, 64)
  $g.Dispose(); $src.Dispose()
  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $fs = [IO.File]::Create($ico); $icon.Save($fs); $fs.Close(); $bmp.Dispose()
}
function Ensure-Logo {
  try {
    $png = Join-Path $dir 'logo.png'; $ico = Join-Path $dir 'logo.ico'
    if (-not (Test-Path $png)) { Invoke-WebRequest -UseBasicParsing -Uri ($script:Server + 'logo.png') -OutFile $png }
    if (-not (Test-Path $ico)) { Make-Ico $png $ico }
    $ms = New-Object IO.MemoryStream(, [IO.File]::ReadAllBytes($png))
    $script:logoImg = [System.Drawing.Image]::FromStream($ms)
    $script:logoIcon = New-Object System.Drawing.Icon($ico)
  } catch { Log "logo setup failed: $_" }
}

function Format-Speed($bps) { (Format-Size $bps) + '/s' }

function Unique-Path($path) {
  if (-not (Test-Path $path)) { return $path }
  $d = Split-Path $path; $b = [IO.Path]::GetFileNameWithoutExtension($path); $x = [IO.Path]::GetExtension($path); $i = 1
  while (Test-Path (Join-Path $d "$b ($i)$x")) { $i++ }
  Join-Path $d "$b ($i)$x"
}

# ---- the "X wants to send you a file" prompt ----
# State travels in control .Tag (handlers run later, without access to this function's locals).
function Show-Prompt($t) {
  $sending = ($t.status -eq 'sending')
  try { [System.Media.SystemSounds]::Asterisk.Play() } catch {}

  $f = New-Object System.Windows.Forms.Form
  $f.Text = 'LAN Share'; $f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false
  $f.TopMost = $true; $f.ClientSize = New-Object System.Drawing.Size(420, 164); $f.StartPosition = 'Manual'
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $slot = [Math]::Max(0, $script:shown.Count - 1) % 4
  $f.Location = New-Object System.Drawing.Point(($wa.Right - 432), ($wa.Bottom - 176 - ($slot * 40)))
  $f.Font = New-Object System.Drawing.Font('Segoe UI', 9)
  $f.BackColor = [System.Drawing.Color]::White
  if ($script:logoIcon) { $f.Icon = $script:logoIcon }
  $textX = if ($script:logoImg) { 64 } else { 16 }

  $title = New-Object System.Windows.Forms.Label
  $title.Text = if ($sending) { '{0} is sending you a file' -f $t.fromName } else { '{0} wants to send you a file' -f $t.fromName }
  $title.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
  $title.SetBounds($textX, 14, 404 - $textX, 26); $title.AutoEllipsis = $true
  $title.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#1e3a8a')

  $file = New-Object System.Windows.Forms.Label
  $file.Text = '{0}  ({1})' -f $t.name, (Format-Size $t.size)
  $file.SetBounds($textX, 46, 404 - $textX, 36); $file.AutoEllipsis = $true

  $status = New-Object System.Windows.Forms.Label
  $status.SetBounds(16, 86, 388, 18); $status.AutoEllipsis = $true
  $bar = New-Object System.Windows.Forms.ProgressBar
  $bar.SetBounds(16, 106, 388, 12); $bar.Visible = $sending

  $accept = New-Object System.Windows.Forms.Button; $accept.Text = 'Accept'; $accept.SetBounds(210, 124, 90, 30)
  $decline = New-Object System.Windows.Forms.Button; $decline.Text = 'Decline'; $decline.SetBounds(310, 124, 90, 30)
  $open = New-Object System.Windows.Forms.Button; $open.Text = 'Show in folder'; $open.SetBounds(16, 124, 120, 30); $open.Visible = $false

  # No AcceptButton on purpose: a stray Enter while typing elsewhere must not accept a file.
  # SSIC blue (#2563eb) primary button, light gray outlined secondary buttons
  $accept.FlatStyle = 'Flat'; $accept.FlatAppearance.BorderSize = 0
  $accept.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#2563eb'); $accept.ForeColor = [System.Drawing.Color]::White
  foreach ($b in @($decline, $open)) { $b.FlatStyle = 'Flat'; $b.FlatAppearance.BorderColor = [System.Drawing.ColorTranslator]::FromHtml('#d1d5db'); $b.BackColor = [System.Drawing.Color]::White }
  $f.Controls.AddRange(@($title, $file, $status, $bar, $accept, $decline, $open))
  if ($script:logoImg) {
    $pic = New-Object System.Windows.Forms.PictureBox
    $pic.Image = $script:logoImg; $pic.SizeMode = 'Zoom'; $pic.SetBounds(16, 12, 38, 48)
    $f.Controls.Add($pic)
  }

  $c = @{ T = $t; Decided = $false; Phase = 'prompt'; State = $t.status; Dest = $null; Wc = $null; Sw = $null; Speed = [double]0; LastRecv = [double]$t.received; LastTick = (Get-Date); Form = $f; Status = $status; Bar = $bar; Accept = $accept; Decline = $decline; Open = $open }
  foreach ($x in @($f, $accept, $decline, $open)) { $x.Tag = $c }
  $script:shown[$t.id] = $c
  Update-Prompt $c $t
  $accept.Add_Click({ param($s, $e) Do-Accept $s.Tag })
  $decline.Add_Click({ param($s, $e) Do-Decline $s.Tag })
  $open.Add_Click({ param($s, $e) Start-Process explorer.exe ('/select,"{0}"' -f $s.Tag.Dest) })
  $f.Add_FormClosed({ param($s, $e) Prompt-Closed $s.Tag })

  if ($selfTest) {
    $f.Opacity = 0; $f.ShowInTaskbar = $false
    $tm = New-Object System.Windows.Forms.Timer; $tm.Interval = 700; $tm.Tag = $c
    $tm.Add_Tick({ param($s, $e) $s.Stop(); $s.Tag.Accept.PerformClick() })
    $tm.Start()
  }
  $f.Show()
}

function Do-Accept($c) {
  $c.Decided = $true
  $c.Accept.Enabled = $false; $c.Decline.Enabled = $false
  try { Api Post ('respond/{0}?device={1}' -f $c.T.id, $script:me.id) @{ accept = $true } | Out-Null } catch { Log "respond failed: $_" }
  if ($c.State -eq 'sending') {
    # Accepted while the sender is still uploading: wait, show their progress, then download automatically.
    $c.Phase = 'waiting'; $c.Bar.Visible = $true; $c.Status.Text = 'Accepted. Waiting for the sender to finish...'
  } else { Start-Download $c }
}

function Start-Download($c) {
  $c.Phase = 'downloading'
  $c.Sw = [System.Diagnostics.Stopwatch]::StartNew()
  $c.Bar.Visible = $true; $c.Bar.Value = 0; $c.Status.Text = 'Receiving...'
  $name = $c.T.name -replace '[\/:*?"<>|]', '_'
  $c.Dest = Unique-Path (Join-Path $recvDir $name)
  $wc = New-Object System.Net.WebClient
  $c.Wc = $wc
  $wc.Add_DownloadProgressChanged({ param($s, $e)
    $c2 = $e.UserState
    $c2.Bar.Value = [Math]::Min(100, $e.ProgressPercentage)
    $sp = $e.BytesReceived / [Math]::Max(0.001, $c2.Sw.Elapsed.TotalSeconds)
    $c2.Status.Text = 'Receiving... {0}% - {1}' -f $e.ProgressPercentage, (Format-Speed $sp)
  })
  $wc.Add_DownloadFileCompleted({ param($s, $e) Download-Done $e })
  $wc.DownloadFileAsync([Uri]($script:Server + ('api/download/{0}?device={1}' -f $c.T.id, $script:me.id)), $c.Dest, $c)
}

# Follows the sender's upload: bar + percentage, and starts the download once it is complete.
function Update-Prompt($c, $item) {
  $c.State = $item.status
  if ($c.Phase -eq 'downloading' -or $c.Phase -eq 'done' -or $c.Phase -eq 'gone') { return }
  $pct = if ([double]$item.size -gt 0) { [Math]::Min(100, [int](100 * [double]$item.received / [double]$item.size)) } else { 0 }
  if ($item.status -eq 'sending') {
    $c.Bar.Visible = $true; $c.Bar.Value = $pct
    $now = Get-Date; $dt = ($now - $c.LastTick).TotalSeconds
    if ($dt -ge 0.8) {
      $inst = ([double]$item.received - $c.LastRecv) / $dt
      $c.Speed = if ($c.Speed -gt 0) { $c.Speed * 0.6 + $inst * 0.4 } else { $inst }
      $c.LastRecv = [double]$item.received; $c.LastTick = $now
    }
    $spd = if ($c.Speed -gt 0) { ' - ' + (Format-Speed $c.Speed) } else { '' }
    $c.Status.Text = if ($c.Phase -eq 'waiting') { "Accepted. Waiting for the sender to finish... $pct%$spd" } else { "Sender is uploading... $pct%$spd" }
  } elseif ($c.Phase -eq 'waiting') { Start-Download $c }
  elseif (-not $c.Decided) { $c.Bar.Visible = $false; $c.Status.Text = 'Ready to receive.' }
}

function Close-Later($c, $ms) {
  $tm = New-Object System.Windows.Forms.Timer; $tm.Interval = $ms; $tm.Tag = $c
  $tm.Add_Tick({ param($s, $e) $s.Stop(); $s.Tag.Form.Close() })
  $tm.Start()
}

function Mark-Gone($c) {
  $c.Phase = 'gone'
  $c.Accept.Enabled = $false; $c.Decline.Enabled = $false; $c.Bar.Visible = $false
  $c.Status.Text = ('{0} cancelled this transfer (or it is no longer available).' -f $c.T.fromName)
  Log "transfer gone: $($c.T.name)"
  Close-Later $c 5000
}

function Download-Done($e) {
  $c = $e.UserState
  if ($e.Cancelled) { Remove-Item $c.Dest -Force -ErrorAction SilentlyContinue; return }
  if ($e.Error) {
    Remove-Item $c.Dest -Force -ErrorAction SilentlyContinue
    $c.Status.Text = 'Failed: ' + $e.Error.Message
    Log "download failed: $($e.Error.Message)"
    return
  }
  $c.Phase = 'done'
  $c.Bar.Value = 100
  $avg = if ($c.Sw) { ' (' + (Format-Speed ((Get-Item $c.Dest).Length / [Math]::Max(0.001, $c.Sw.Elapsed.TotalSeconds))) + ' avg)' } else { '' }
  $c.Status.Text = 'Saved: ' + (Split-Path $c.Dest -Leaf) + $avg
  $c.Open.Visible = $true
  $script:notify.ShowBalloonTip(4000, 'LAN Share', ('Received {0} from {1}' -f $c.T.name, $c.T.fromName), 'Info')
  Log "received $($c.Dest)"
  Close-Later $c 15000
}

function Do-Decline($c) {
  $c.Decided = $true
  try { Api Post ('respond/{0}?device={1}' -f $c.T.id, $script:me.id) @{ accept = $false } | Out-Null } catch { Log "respond failed: $_" }
  $c.Form.Close()
}

function Prompt-Closed($c) {
  $script:shown.Remove($c.T.id)
  if ($c.Wc) { try { $c.Wc.CancelAsync() } catch {} }
  # Closed with the X, no decision: ask again later instead of silently losing the offer.
  if (-not $c.Decided -and $c.Phase -eq 'prompt') { $script:snooze[$c.T.id] = (Get-Date).AddMinutes(10) }
}

# ---- polling ----
function Poll {
  if (-not $script:me) {
    try { $script:me = (Api Post 'agent/hello' @{ id = $agentId }).device; Log "registered as $($script:me.name)" }
    catch { return }   # 404 until this PC has opened LAN Share in a browser once; network errors retry
  }
  try { $list = @(Api Get ('pending?device=' + $script:me.id)) }
  catch { $script:me = $null; return }
  $present = @{}
  foreach ($t in $list) {
    if (-not $t -or -not $t.id) { continue }   # an empty JSON list can arrive as one $null item
    $present[$t.id] = $true
    if ($script:shown.ContainsKey($t.id)) { Update-Prompt $script:shown[$t.id] $t; continue }
    if ($t.response) { continue }              # already answered earlier (e.g. before a restart)
    if ($script:snooze.ContainsKey($t.id) -and $script:snooze[$t.id] -gt (Get-Date)) { continue }
    Show-Prompt $t
  }
  # An open prompt whose transfer is no longer listed: the sender cancelled it.
  foreach ($id in @($script:shown.Keys)) {
    $c = $script:shown[$id]
    if (-not $present.ContainsKey($id) -and ($c.Phase -eq 'prompt' -or $c.Phase -eq 'waiting')) { Mark-Gone $c }
  }
  if ($script:timer) { $script:timer.Interval = if ($script:shown.Count) { 1000 } else { 5000 } }   # the first poll runs before the timer exists
}

# Returns $true if a newer script was installed and relaunched (caller should exit).
function Update-Self {
  try {
    $v = Api Get 'agent/version'
    if ([int]$v.version -le $AgentVersion) { return $false }
    $self = $PSCommandPath; $tmp = $self + '.new'
    Invoke-WebRequest -UseBasicParsing -Uri ($script:Server + 'agent.ps1') -OutFile $tmp
    Move-Item $tmp $self -Force
    Log "updated to v$($v.version), restarting"
    $mutex.ReleaseMutex()
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-STA', '-File', ('"' + $self + '"')
    return $true
  } catch { Log "update check failed: $_"; return $false }
}

# ---- tray icon ----
$script:ctx = New-Object System.Windows.Forms.ApplicationContext
$script:notify = New-Object System.Windows.Forms.NotifyIcon
Ensure-Logo
$script:notify.Icon = if ($script:logoIcon) { $script:logoIcon } else { [System.Drawing.SystemIcons]::Application }
$script:notify.Text = 'SSIC File Sharing receiver'
$menu = New-Object System.Windows.Forms.ContextMenuStrip
[void]$menu.Items.Add('Open LAN Share', $null, { Start-Process $script:Server })
[void]$menu.Items.Add('Open received files', $null, { Start-Process explorer.exe ('"{0}"' -f $recvDir) })
[void]$menu.Items.Add('Quit receiver', $null, { $script:notify.Visible = $false; $script:ctx.ExitThread() })
$script:notify.ContextMenuStrip = $menu
$script:notify.Visible = $true

if (Update-Self) { exit }
Log "receiver v$AgentVersion started, server $($script:Server)"
try { Poll } catch { Log "poll error: $_" }

$script:timer = New-Object System.Windows.Forms.Timer
$script:timer.Interval = 5000
$script:timer.Add_Tick({
  try {
    Poll
    $script:ticks++
    if ($script:ticks % 720 -eq 0 -and (Update-Self)) { $script:notify.Visible = $false; $script:ctx.ExitThread() }   # hourly
  } catch { Log "poll error: $_" }
})
$script:timer.Start()
[System.Windows.Forms.Application]::Run($script:ctx)
$script:notify.Visible = $false; $script:notify.Dispose()
