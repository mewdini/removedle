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
Remove-LinkOrDir "static/assets/challenger/art"
Remove-LinkOrDir "static/challenges"

# Create Junctions.
#
# static/challenges covers BOTH modes: out/dailies holds normal's days at its
# root and each other mode nested under it (out/dailies/challenger/<date>),
# mirroring the R2 key space so dev URLs match production exactly.
cmd /c mklink /j static\assets\art out\covers
cmd /c mklink /j static\challenges out\dailies

if (Test-Path "out/challenger/covers") {
    New-Item -ItemType Directory -Force -Path "static/assets/challenger"
    cmd /c mklink /j static\assets\challenger\art out\challenger\covers
}

# Copy metadata manifests
function Copy-Manifests {
    param([string]$DataDir, [string]$Target)

    if (-not (Test-Path $DataDir)) { return }
    New-Item -ItemType Directory -Force -Path $Target | Out-Null

    foreach ($name in @("songs.json", "covers.json")) {
        if (Test-Path "$DataDir/$name") {
            Copy-Item "$DataDir/$name" "$Target/$name"
        }
    }
}

Copy-Manifests "out/data" "static/assets"
Copy-Manifests "out/challenger/data" "static/assets/challenger"

Write-Host "Local assets successfully linked!" -ForegroundColor Green
