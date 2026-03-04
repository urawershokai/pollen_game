Add-Type -AssemblyName System.Drawing
function Resize-Image {
    param($InputPath, $OutputPath, $Width, $Height)
    $img = [System.Drawing.Image]::FromFile($InputPath)
    $newImg = New-Object System.Drawing.Bitmap($Width, $Height)
    $g = [System.Drawing.Graphics]::FromImage($newImg)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, 0, 0, $Width, $Height)
    $newImg.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $newImg.Dispose()
    $img.Dispose()
}
Resize-Image -InputPath 'C:\dev\ag_projects\pollen_game\pollen_dodge.png' -OutputPath 'C:\dev\ag_projects\pollen_game\icon-192.png' -Width 192 -Height 192
Resize-Image -InputPath 'C:\dev\ag_projects\pollen_game\pollen_dodge.png' -OutputPath 'C:\dev\ag_projects\pollen_game\icon-512.png' -Width 512 -Height 512
