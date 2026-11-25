#!/bin/sh
# Generate deploy/freeswitch-vars.xml from the switch image with the internal
# SIP port set to 5072, for the compose.sip5072.yml bind mount.
#
# Why: the edge router at the public IP runs a SIP ALG on 5060 that rewrites
# the SIP payload and the SDP media port, breaking RTP. FreeSWITCH listens on
# 5072 instead and the edge maps 5072/udp to it. See CUSTOM-DEPLOY.md.
#
# Re-run after every switch image upgrade: the new image carries a fresh
# vars.xml, and the mounted copy must be regenerated from it.
set -eu
cd "$(dirname "$0")"

image="${AICC_FS_IMAGE:-rasonyang/freeswitch-aicc:v0.9.1}"
name="aicc-fs-vars-$$"
tmp="$(mktemp)"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true; rm -f "$tmp"' EXIT

docker create --name "$name" "$image" >/dev/null
docker cp "$name:/usr/local/freeswitch/conf/vars.xml" "$tmp"
sed -i 's/internal_sip_port=5060/internal_sip_port=5072/' "$tmp"
grep -q 'internal_sip_port=5072' "$tmp"
mv "$tmp" freeswitch-vars.xml
echo "wrote $(pwd)/freeswitch-vars.xml (internal_sip_port=5072)"
