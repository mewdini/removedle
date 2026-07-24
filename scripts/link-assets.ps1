# Create static directory structures
New-Item -ItemType Directory -Force -Path "static/assets"

# Remove existing links/folders if they exist to prevent mklink failures.
#
# Use rmdir, not Remove-Item -Recurse. Remove-Item can follow a junction into
# its target and delete the real files, which here would wipe out/covers or
# out/dailies -- the generated output the junctions point at. rmdir removes the
# link itself and leaves the target alone. It only works on directories and
# links, so fall back to Remove-Item for anything else that occupies the path.
function Remove-LinkOrDir {
    param([string]$Path)

    if (-not (Test-Path $Path)) { return }

    $item = Get-Item -LiteralPath $Path -Force
    $isLink = $item.Attributes -band [IO.FileAttributes]::ReparsePoint

    if ($isLink) {
        # rmdir deletes the link and leaves the target untouched.
        cmd /c rmdir "$($item.FullName)"
    }
    else {
        # A real directory has no link to follow, so recursing is safe here.
        Remove-Item -Recurse -Force -LiteralPath $Path
    }
}

Remove-LinkOrDir "static/assets/art"
Remove-LinkOrDir "static/challenges"

# Create Junctions
cmd /c mklink /j static\assets\art out\covers
cmd /c mklink /j static\challenges out\dailies

# Copy metadata manifests
if (Test-Path "out/data/songs.json") {
    Copy-Item "out/data/songs.json" "static/assets/songs.json"
}
if (Test-Path "out/data/covers.json") {
    Copy-Item "out/data/covers.json" "static/assets/covers.json"
}

Write-Host "Local assets successfully linked!" -ForegroundColor Green
