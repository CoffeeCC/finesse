#!/bin/bash
# Compiles every iss/NN-*.iss with Inno Setup's compiler under Wine, into out/NN-*/.
set -u
cd "$(dirname "$0")/../iss"
export WINEPREFIX=/e/prefix DISPLAY=:9
Xvfb :9 >/dev/null 2>&1 &
for iss in [0-9][0-9]-*.iss; do
  start=$(date +%s)
  wine 'C:\Inno\ISCC.exe' /Q "$iss" > "/tmp/${iss%.iss}.log" 2>&1
  rc=$?
  printf '%-24s exit %s in %3ss  %s\n' "${iss%.iss}" "$rc" "$(( $(date +%s) - start ))" "$(ls ../out/"${iss%.iss}" 2>/dev/null | tr '\n' ' ')"
  [ "$rc" = 0 ] || tr -d '\r' < "/tmp/${iss%.iss}.log" | tail -5
done
wineserver -k 2>/dev/null
