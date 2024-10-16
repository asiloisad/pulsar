#!/usr/bin/env bash

# NOTE: This script is a post-build task for the Linux AppImage version of
# Pulsar. It's meant to run in Pulsar's CI and almost certainly won't do
# anything useful if run on your local machine.

# Usage: Takes a single argument for the architecture — either `x86_64` or
# `ARM_64` — and “fixes” an AppImage file as emitted by `electron-builder` so
# that it points to `pulsar.sh` internally and runs _that_ when invoked instead
# of the direct binary.
#
# This is important for a couple of reasons:
#
# 1. Some command-line arguments, like `--wait`, don't work properly unless
#    they rely on `pulsar.sh` to do some work for them.
# 2. `pulsar.sh` can intercept the `-p`/`--package` switch (signaling that the
#     user wants to run `ppm`) and call it more quickly than Pulsar can.
#
# This is pretty easy to do with an AppImage, but `electron-builder` isn't
# customizable enough for us to make that change without it affecting other
# things. Luckily, AppImage is straightforward enough as a tool that we can
# do it manually.
#
# The workflow here is as follows:
#
# * Extract the AppImage (every AppImage has the ability to do this by itself).
# * Modify the `AppRun` script whose purpose is to invoke the Electron
#   executable; modify it to invoke our `pulsar.sh` script instead.
# * Download and extract `appimagetool`.
# * Use it to package everything back into an AppImage at the original location
#   on disk.
#
# If you're unsure if this modification has worked, the best way to find out is
# to run
#
#   ./Pulsar.AppImage --wait foo.txt
#
# and keep an eye on the terminal window after Pulsar launches. It should not
# return to a new prompt until you close `foo.txt` for editing. If you don't
# get a new prompt after closing `foo.txt`, or if you see logging statements in
# your terminal after launch, then it's almost certain that the AppImage hasn't
# been fixed.


# Fail on first error. None of these steps is prone to random failure, except
# _possibly_ the part where we download `appimagetool`; if that's ever the
# cause of failures, we could spin that off into a separate step that uses
# the `retry` action. Otherwise this script is quite straightforward.
set -e

# Use `appimagetool`’s names for our two processor architectures.
if [[ "${1:x86_64}" == "x86_64" ]]; then
  APPIMAGE_ARCH="x86_64"
else
  APPIMAGE_ARCH="aarch64"
fi

echo "Architecture is: ${APPIMAGE_ARCH}"

cd binaries
PULSAR_APPIMAGE="$(ls *.AppImage | xargs)"
echo "Existing binary is ${PULSAR_APPIMAGE}."
chmod +x "${PULSAR_APPIMAGE}"

echo "Extracting ${PULSAR_APPIMAGE} to Pulsar.AppDir…"
"./${PULSAR_APPIMAGE}" "--appimage-extract"
# Will extract to `squashfs-root`. Let's rename it just for sanity.
mv "squashfs-root" "Pulsar.AppDir"

# Move the `AppImage` to a new filename because we'll be replacing it soon.
mv "${PULSAR_APPIMAGE}" "${PULSAR_APPIMAGE%.AppImage}.old.AppImage"

# `AppRun` is the entry point of an `AppImage`. Ours is generated by
# `electron-builder`. We need to customize it to launch a script rather than
# our executable.

# First we'll copy the existing `AppRun` file to a temporary path.
cd "Pulsar.AppDir"
echo "Moving AppRun to AppRun.old…"
mv AppRun AppRun.old
rm -f AppRun

# Next we'll use `awk` to replace the reference to BIN in `AppRun` so that it
# points to `pulsar.sh` rather than the `pulsar` executable.
echo "Making new AppRun…"
awk '{sub(/BIN=(.*?)/,"BIN=\"$APPDIR/resources/pulsar.sh\""); print}' AppRun.old > AppRun
chmod a+x AppRun

# For sanity's sake, show the new line so we know that this was done properly
# just by inspecting the CI job output. This will help if we ever upgrade
# `electron-builder` and find that this generated line has changed somehow.
echo "Rewrote BIN to read:"
cat AppRun | grep "BIN="

# We don't need the old `AppRun` anymore.
echo "Removing AppRun.old…"
rm -f AppRun.old

cd ../..

# Now that we've made the change, we can use `appimagetool` to bundle
# everything up with the original file name.
echo "Downloading appimagetool…"
wget "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-${APPIMAGE_ARCH}.AppImage" -O appimagetool
echo "Making appimagetool executable…"
chmod +x appimagetool

# Docker can't run AppImage apps natively, but we can use the
# `--appimage-extract-and-run` option to extract the app to a location on disk
# instead.
#
# It makes us set an `ARCH` environment variable — no idea why, since these are
# thin binaries, but whatever.
echo "Building new AppImage at: binaries/${PULSAR_APPIMAGE}"
ARCH="${APPIMAGE_ARCH}" ./appimagetool --appimage-extract-and-run "binaries/Pulsar.AppDir" "binaries/${PULSAR_APPIMAGE}"
chmod a+x "binaries/${PULSAR_APPIMAGE}"
echo "…done building AppImage."

# Clean up! Remove the old AppImage and the temporary directory.
echo "Removing temporary Pulsar.AppDir and old AppImage…"
rm -rf "binaries/Pulsar.AppDir"
rm -f "binaries/${PULSAR_APPIMAGE%.AppImage}.old.AppImage"

echo "…done! AppImage is fixed!"
