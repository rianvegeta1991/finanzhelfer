# Zeichnet die PNG-Icons nach den SVG-Vorlagen nach.
# Auf dem Rechner gibt es keinen SVG-Renderer, deshalb wird das Motiv hier mit
# System.Drawing noch einmal von Hand gezeichnet. Bei Logoaenderungen muessen
# icon.svg / icon-maskable.svg UND dieses Skript angepasst werden.
#
# Motiv: steigende Linie mit Goldmuenze am Hochpunkt, Koordinaten aus dem
# 512er-Raster der SVG-Vorlage.

Add-Type -AssemblyName System.Drawing

$root  = Split-Path -Parent $MyInvocation.MyCommand.Path
$blau  = [System.Drawing.ColorTranslator]::FromHtml("#1d6a8c")
$weiss = [System.Drawing.Color]::White
$gold  = [System.Drawing.ColorTranslator]::FromHtml("#e8b75c")

# Punkte im 512er-Raster, auf 0..1 normiert. Zwei flache Listen statt einer
# Liste von Paaren: PowerShell verflacht verschachtelte Arrays sonst still.
$px = @(139.0, 213.0, 266.0, 373.0)
$py = @(331.0, 246.0, 291.0, 160.0)
for ($i = 0; $i -lt $px.Count; $i++) { $px[$i] = $px[$i] / 512.0; $py[$i] = $py[$i] / 512.0 }
$strichAnteil = 36.0/512
$muenzAnteil  = 36.0/512

function New-Icon {
    param(
        [int]$Size,             # Kantenlaenge in Pixel
        [string]$Datei,
        [double]$EckenAnteil,   # Eckenradius im Verhaeltnis zur Kante (0 = eckig)
        [double]$Motiv          # Motivgroesse im Verhaeltnis zur Kante (1 = wie die SVG-Vorlage)
    )

    $bild = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bild)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # Hintergrundflaeche
    $pinsel = New-Object System.Drawing.SolidBrush($blau)
    if ($EckenAnteil -gt 0) {
        $r = [double]($Size * $EckenAnteil)
        $pfad = New-Object System.Drawing.Drawing2D.GraphicsPath
        $pfad.AddArc(0, 0, 2*$r, 2*$r, 180, 90)
        $pfad.AddArc($Size-2*$r, 0, 2*$r, 2*$r, 270, 90)
        $pfad.AddArc($Size-2*$r, $Size-2*$r, 2*$r, 2*$r, 0, 90)
        $pfad.AddArc(0, $Size-2*$r, 2*$r, 2*$r, 90, 90)
        $pfad.CloseFigure()
        $g.FillPath($pinsel, $pfad)
        $pfad.Dispose()
    } else {
        $g.FillRectangle($pinsel, 0, 0, $Size, $Size)
    }
    $pinsel.Dispose()

    # Motiv um die Bildmitte skalieren
    $mitte = $Size / 2.0
    $skala = $Size * $Motiv
    $sx = New-Object double[] $px.Count
    $sy = New-Object double[] $px.Count
    for ($i = 0; $i -lt $px.Count; $i++) {
        $sx[$i] = ($px[$i] - 0.5) * $skala + $mitte
        $sy[$i] = ($py[$i] - 0.5) * $skala + $mitte
    }

    # Linienzug mit runden Enden und Ecken
    $stift = New-Object System.Drawing.Pen($weiss, [float]($strichAnteil * $skala))
    $stift.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $stift.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $stift.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    for ($i = 0; $i -lt $sx.Count - 1; $i++) {
        $g.DrawLine($stift, [float]$sx[$i], [float]$sy[$i], [float]$sx[$i+1], [float]$sy[$i+1])
    }
    $stift.Dispose()

    # Goldmuenze auf dem Hochpunkt
    $lx = $sx[$sx.Count - 1]
    $ly = $sy[$sy.Count - 1]
    $mr = $muenzAnteil * $skala
    $mPinsel = New-Object System.Drawing.SolidBrush($gold)
    $g.FillEllipse($mPinsel, [float]($lx-$mr), [float]($ly-$mr), [float](2*$mr), [float](2*$mr))
    $mPinsel.Dispose()

    $g.Dispose()
    $pfadAus = Join-Path $root $Datei
    $bild.Save($pfadAus, [System.Drawing.Imaging.ImageFormat]::Png)
    $bild.Dispose()
    Write-Output "$Datei geschrieben ($Size x $Size)"
}

# Normale Icons: abgerundetes Quadrat wie die SVG-Vorlage (Radius 112/512)
New-Icon -Size 192 -Datei "icon-192.png" -EckenAnteil (112.0/512) -Motiv 1.0
New-Icon -Size 512 -Datei "icon-512.png" -EckenAnteil (112.0/512) -Motiv 1.0

# Maskable: randlos. Das Motiv bleibt in Originalgroesse - sein weitester Punkt
# liegt bei Radius ~181 und damit innerhalb des Sicherheitskreises (205 px).
New-Icon -Size 512 -Datei "icon-512-maskable.png" -EckenAnteil 0 -Motiv 1.0

# Apple legt seine eigene Maske darueber, deshalb eckig und randlos
New-Icon -Size 180 -Datei "apple-touch-icon.png" -EckenAnteil 0 -Motiv 1.0
