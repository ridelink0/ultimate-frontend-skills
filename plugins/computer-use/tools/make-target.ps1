# Generates a throwaway WinForms window with known controls, purely as an
# Computer Use test target. Nothing pre-existing on the machine is ever used for tests.
# Prints its window title and PID as JSON, then blocks until closed.

param([switch]$CenterTop, [switch]$Right)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$title = "Computer Use Test Target $PID"

$form                = New-Object System.Windows.Forms.Form
$form.Text           = $title
$form.Size           = New-Object System.Drawing.Size(560, 460)
$form.StartPosition  = 'Manual'
# CenterTop parks the window where Computer Use draws its own banner, so a test
# can prove a real click near the top of the screen reaches the app underneath
# instead of being swallowed by that banner.
if ($CenterTop) {
    $w = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width
    # -25 so the first button's centre lands inside the banner's band, not just
    # below it - the whole point of this position is to sit under the banner.
    $form.Location = New-Object System.Drawing.Point(([int]($w / 2) - 200), -25)
} elseif ($Right) {
    # Right edge of the primary screen, clear of a browser window on the left,
    # for a test that needs "the user's window" beside the one it clicks in.
    $w = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Width
    $form.Location = New-Object System.Drawing.Point(($w - 560), 120)
} else {
    $form.Location = New-Object System.Drawing.Point(120, 120)
}
$form.TopMost        = $false

$btn                 = New-Object System.Windows.Forms.Button
$btn.Name            = 'goButton'
$btn.Text            = 'Press Me'
$btn.Location        = New-Object System.Drawing.Point(20, 20)
$btn.Size            = New-Object System.Drawing.Size(120, 32)

$status              = New-Object System.Windows.Forms.Label
$status.Name         = 'statusLabel'
$status.Text         = 'idle'
$status.Location     = New-Object System.Drawing.Point(160, 26)
$status.Size         = New-Object System.Drawing.Size(340, 24)

$script:presses = 0
$btn.Add_Click({ $script:presses++; $status.Text = "pressed:$($script:presses)" })

$edit                = New-Object System.Windows.Forms.TextBox
$edit.Name           = 'nameBox'
$edit.Location       = New-Object System.Drawing.Point(20, 70)
$edit.Size           = New-Object System.Drawing.Size(300, 24)
$edit.Text           = ''
$edit.AccessibleName = 'Name field'

$check               = New-Object System.Windows.Forms.CheckBox
$check.Name          = 'agreeBox'
$check.Text          = 'I agree'
$check.Location      = New-Object System.Drawing.Point(20, 110)
$check.Size          = New-Object System.Drawing.Size(140, 24)

$combo               = New-Object System.Windows.Forms.ComboBox
$combo.Name          = 'colourCombo'
$combo.Location      = New-Object System.Drawing.Point(180, 110)
$combo.Size          = New-Object System.Drawing.Size(160, 24)
$combo.AccessibleName = 'Colour'
[void]$combo.Items.AddRange(@('Red', 'Green', 'Blue'))
$combo.SelectedIndex = 0

# A multiline box with more content than fits, to prove that snapshot returns
# text scrolled outside the viewport - the thing a screenshot cannot show.
$multi               = New-Object System.Windows.Forms.TextBox
$multi.Name          = 'notesBox'
$multi.Multiline     = $true
$multi.ScrollBars    = 'Vertical'
$multi.Location      = New-Object System.Drawing.Point(20, 150)
$multi.Size          = New-Object System.Drawing.Size(480, 120)
$multi.AccessibleName = 'Notes'
$lines = @()
for ($i = 1; $i -le 40; $i++) { $lines += "line $i of hidden scrollback content" }
$multi.Text = ($lines -join "`r`n")

$list                = New-Object System.Windows.Forms.ListBox
$list.Name           = 'itemList'
$list.Location       = New-Object System.Drawing.Point(20, 285)
$list.Size           = New-Object System.Drawing.Size(200, 100)
$list.AccessibleName = 'Items'
[void]$list.Items.AddRange(@('Alpha', 'Bravo', 'Charlie', 'Delta'))

$disabled            = New-Object System.Windows.Forms.Button
$disabled.Name       = 'disabledButton'
$disabled.Text       = 'Disabled'
$disabled.Enabled    = $false
$disabled.Location   = New-Object System.Drawing.Point(250, 285)
$disabled.Size       = New-Object System.Drawing.Size(120, 32)

# A control whose own label says the click has consequences, so the
# confirmation gate has something real to fire on. It does nothing but count.
$send                = New-Object System.Windows.Forms.Button
$send.Name           = 'sendButton'
$send.Text           = 'Send Payment'
$send.Location       = New-Object System.Drawing.Point(250, 330)
$send.Size           = New-Object System.Drawing.Size(140, 32)
$send.Add_Click({ $script:presses++; $status.Text = "pressed:$($script:presses)" })

$form.Controls.AddRange(@($btn, $status, $edit, $check, $combo, $multi, $list, $disabled, $send))

$form.Add_Shown({
    $form.Activate()
    $info = @{ title = $title; pid = $PID; hwnd = [int64]$form.Handle } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($info)
    [Console]::Out.Flush()
})

[void]$form.ShowDialog()
