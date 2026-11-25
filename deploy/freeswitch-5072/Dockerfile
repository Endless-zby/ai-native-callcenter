# Derived switch image: internal SIP port 5072 instead of 5060.
#
# The edge router at the public IP runs a SIP ALG on 5060 that rewrites the
# SIP payload (220.197.177.220 -> 10.1.91.56) and the SDP media port (a
# controlled probe sent m=audio 5098 and arrived as m=audio 5100), breaking
# RTP in both directions. FreeSWITCH listens on 5072 and the edge maps
# 5072/udp to 10.1.91.56:5072, where the ALG does not look.
#
# A bind-mounted vars.xml does not work: the entrypoint rewrites vars.xml with
# sed -i, which fails on a single-file mount ("Device or resource busy").
# Changing the file at build time keeps the entrypoint's in-place rewrite.
#
# Build: docker build -t aicc-freeswitch:5072 deploy/freeswitch-5072
# Use:   deploy/.env  AICC_FS_IMAGE=aicc-freeswitch:5072
#
# On a switch image upgrade, bump FROM and rebuild; otherwise the port reverts
# to 5060 and public media breaks again.
FROM rasonyang/freeswitch-aicc:v0.9.1
USER root
RUN sed -i 's/internal_sip_port=5060/internal_sip_port=5072/' /usr/local/freeswitch/conf/vars.xml
