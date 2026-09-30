# Architecture

## Proven proof-of-concept path

Echo Show camera -> Amazon Live View signaling -> Alexa RTCSessionController -> WebRTC -> H.264 RTP depacketization -> MediaCodec input -> Annex-B H.264.

Observed initial Annex-B access unit:

SPS -> PPS -> IDR

NAL types: 7 -> 8 -> 5.

Parameter sets were observed in-band rather than through MediaFormat csd-0 / csd-1.

The resulting elementary stream was successfully decoded with FFmpeg.

## Production target

The Android/Frida implementation is a research scaffold. The target is a standalone Linux daemon handling authenticated Amazon control-plane communication, Live View requests, RTCSessionController signaling, SDP/ICE/DTLS/SRTP, H.264 RTP reception/depacketization, and local stream publication.

Likely stack: Go, Pion WebRTC, MediaMTX/go2rtc, systemd, Home Assistant.
