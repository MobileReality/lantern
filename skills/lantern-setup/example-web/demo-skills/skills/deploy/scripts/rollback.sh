#!/bin/sh
set -eu

release="${1:?usage: rollback.sh <release-tag>}"
git checkout "$release"
echo "rolled back to $release"
