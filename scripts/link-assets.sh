#!/bin/bash

# Create static directory structures
mkdir -p static/assets

# Remove existing links/folders if they exist
rm -rf static/assets/art
rm -rf static/assets/challenger
rm -rf static/challenges

# Create Symlinks.
#
# static/challenges covers BOTH modes: out/dailies holds normal's days at its
# root and each other mode nested under it (out/dailies/challenger/<date>),
# mirroring the R2 key space so dev URLs match production exactly.
ln -s ../../out/covers static/assets/art
ln -s ../../out/dailies static/challenges

if [ -d "out/challenger/covers" ]; then
    mkdir -p static/assets/challenger
    ln -s ../../../out/challenger/covers static/assets/challenger/art
fi

# Copy metadata manifests
copy_manifests() {
    local data_dir="$1"
    local target="$2"

    [ -d "$data_dir" ] || return 0
    mkdir -p "$target"

    for name in songs.json covers.json; do
        if [ -f "$data_dir/$name" ]; then
            cp "$data_dir/$name" "$target/$name"
        fi
    done
}

copy_manifests out/data static/assets
copy_manifests out/challenger/data static/assets/challenger

echo "Local assets successfully linked!"
